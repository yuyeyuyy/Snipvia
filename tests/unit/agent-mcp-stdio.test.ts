import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { MCPClient, type MCPClientEvents } from '../../src/main/agent/mcp/MCPClient';
import { parseMCPConfig, serverEnvironment } from '../../src/main/agent/mcp/config';
import { MCPManager } from '../../src/main/agent/mcp/MCPManager';
import { ToolRegistry } from '../../src/main/agent/ToolRegistry';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { WorkspaceService } from '../../src/main/agent/WorkspaceService';
import { PermissionManager } from '../../src/main/agent/PermissionManager';
import { AgentLoop } from '../../src/main/agent/AgentLoop';
import type { AgentChatRequest, LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import type { AgentChatResponse } from '../../src/shared/agent/message';

const fixture = resolve('tests/fixtures/mcp/server.mjs');
const clients: MCPClient[] = [];
const signal = () => new AbortController().signal;
function config(mode = 'normal', timeout = 1500, connectTimeout = 5000) {
  return parseMCPConfig({ mcpServers: { fixture: { command: process.execPath, args: [fixture, mode], connectTimeoutMs: connectTimeout, requestTimeoutMs: timeout, reconnect: { maxAttempts: 0 } } } });
}
function client(mode = 'normal', timeout = 1500, callbacks: Partial<MCPClientEvents> = {}, connectTimeout = 5000) {
  // Request-timeout tests must reach an established connection before testing the 150ms request limit.
  const settings = config(mode, timeout, connectTimeout).mcpServers.fixture;
  const instance = new MCPClient(settings, serverEnvironment(settings), { disconnected: () => {}, toolsChanged: () => {}, ...callbacks }); clients.push(instance); return instance;
}
afterEach(async () => { await Promise.all(clients.splice(0).map((item) => item.close())); vi.unstubAllEnvs(); });

describe('actual stdio MCP protocol (local synthetic server, no GUI/network)', () => {
  it('initializes, lists tools and calls over a real child pipe', async () => {
    const connection = client(); await connection.connect(signal());
    expect((await connection.listTools(signal()))[0].name).toBe('Echo.Text');
    expect(await connection.callTool('Echo.Text', { text: '你好 MCP' }, signal())).toMatchObject({ content: [{ text: '你好 MCP' }] });
  });
  it('collects paginated tools', async () => {
    const connection = client('pagination'); await connection.connect(signal());
    expect((await connection.listTools(signal())).map((item) => item.name)).toEqual(['Echo.Text', 'Second']);
  });
  it.each(['cursor-loop', 'duplicates'])('rejects invalid discovery: %s', async (mode) => {
    const connection = client(mode); await connection.connect(signal());
    await expect(connection.listTools(signal())).rejects.toMatchObject({ code: 'MCP_PROTOCOL_ERROR' });
  });
  it.each(['bad-json', 'oversized', 'crash-init', 'no-tools'])('fails closed during handshake: %s', async (mode) => {
    await expect(client(mode).connect(signal())).rejects.toBeInstanceOf(Error);
  });
  it('enforces handshake timeout', async () => {
    await expect(client('hang-init', 150, {}, 150).connect(signal())).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('enforces list timeout', async () => {
    const connection = client('hang-list', 150); await connection.connect(signal());
    await expect(connection.listTools(signal())).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('enforces call timeout and keeps the connection usable without replaying calls', async () => {
    const connection = client('normal', 150); await connection.connect(signal());
    await expect(connection.callTool('hang', {}, signal())).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(await connection.callTool('Echo.Text', { text: 'next' }, signal())).toMatchObject({ content: [{ text: 'next' }] });
  });
  it('aborts a call and ignores a late response without breaking another call', async () => {
    const connection = client(); await connection.connect(signal()); const abort = new AbortController();
    const pending = connection.callTool('hang', {}, abort.signal); const check = expect(pending).rejects.toMatchObject({ code: 'ABORTED' }); abort.abort(); await check;
    expect(await connection.callTool('Echo.Text', { text: 'other' }, signal())).toMatchObject({ content: [{ text: 'other' }] });
  });
  it('propagates crash to pending calls and notifies the manager', async () => {
    const disconnected = vi.fn(); const connection = client('normal', 1500, { disconnected }); await connection.connect(signal());
    await expect(connection.callTool('crash', {}, signal())).rejects.toMatchObject({ code: 'MCP_DISCONNECTED' }); expect(disconnected).toHaveBeenCalledOnce();
  });
  it('closing a live connection rejects pending requests and cannot be reused', async () => {
    const connection = client(); await connection.connect(signal());
    const pending = connection.callTool('hang', {}, signal());
    const check = expect(pending).rejects.toMatchObject({ code: 'MCP_DISCONNECTED' });
    await connection.close(); await check;
    await expect(connection.callTool('Echo.Text', { text: 'closed' }, signal())).rejects.toMatchObject({ code: 'MCP_DISCONNECTED' });
  });
  it('real process crashes trigger manager reconnect and fresh tool discovery', async () => {
    const registry = new ToolRegistry(); const permissions = new PermissionManager({ prompt: async () => 'allow_once' });
    const connections: MCPClient[] = [];
    const manager = new MCPManager(registry, permissions, { clientFactory: (settings, env, events) => {
      const connection = new MCPClient(settings, env, events); connections.push(connection); return connection;
    } });
    try {
      const settings = config(); settings.mcpServers.fixture.reconnect = { maxAttempts: 1, initialDelayMs: 100 };
      await manager.start(settings); expect(registry.descriptors()).toHaveLength(1);
      await expect(connections[0].callTool('crash', {}, signal())).rejects.toMatchObject({ code: 'MCP_DISCONNECTED' });
      expect(registry.descriptors()).toHaveLength(0);
      await vi.waitFor(() => expect(manager.status()[0].state).toBe('connected'));
      expect(connections).toHaveLength(2); expect(registry.descriptors()).toHaveLength(1);
    } finally { await manager.stop(); }
  });
  it('distinguishes tool errors from sanitized protocol errors and malformed results', async () => {
    const connection = client(); await connection.connect(signal());
    expect(await connection.callTool('tool_error', {}, signal())).toMatchObject({ isError: true });
    await expect(connection.callTool('rpc_error', {}, signal())).rejects.toMatchObject({ code: 'MCP_PROTOCOL_ERROR', message: 'MCP Server 返回协议错误或无效结果' });
    await expect(connection.callTool('invalid_result', {}, signal())).rejects.toMatchObject({ code: 'MCP_PROTOCOL_ERROR' });
  });
  it('receives tool-list-changed notifications', async () => {
    const toolsChanged = vi.fn(); const connection = client('normal', 1500, { toolsChanged }); await connection.connect(signal());
    await connection.callTool('change', {}, signal()); expect(toolsChanged).toHaveBeenCalledOnce(); expect((await connection.listTools(signal()))[0].description).toBe('Updated echo');
  });
  it('does not leak ambient API keys to the spawned process', async () => {
    vi.stubEnv('SNIPVIA_TEST_SECRET', 'should-not-inherit'); vi.stubEnv('TEST_MCP_SOURCE', 'explicit-value');
    const settings = config().mcpServers.fixture; settings.envFrom.TEST_MCP_VALUE = 'TEST_MCP_SOURCE';
    const connection = new MCPClient(settings, serverEnvironment(settings), { disconnected: () => {}, toolsChanged: () => {} }); clients.push(connection);
    await connection.connect(signal());
    expect(await connection.callTool('env', {}, signal())).toMatchObject({ content: [{ text: '{"forwarded":"explicit-value"}' }] });
  });
  it('does not interpret args as a shell command', async () => {
    const settings = config().mcpServers.fixture; settings.args.push('$(touch /should-never-be-created)');
    const connection = new MCPClient(settings, serverEnvironment(settings), { disconnected: () => {}, toolsChanged: () => {} }); clients.push(connection);
    await connection.connect(signal()); expect(await connection.callTool('Echo.Text', { text: 'literal' }, signal())).toMatchObject({ content: [{ text: 'literal' }] });
  });
  it('refuses missing executables and shell batch files', async () => {
    for (const command of ['/snipvia-nonexistent/executable', 'server.cmd']) {
      const settings = config().mcpServers.fixture; settings.command = command;
      const connection = new MCPClient(settings, serverEnvironment(settings), { disconnected: () => {}, toolsChanged: () => {} }); clients.push(connection);
      await expect(connection.connect(signal())).rejects.toBeInstanceOf(Error);
    }
  });
  it('runs through unchanged AgentLoop → registry → approval → stdio → model result', async () => {
    const permissions = new PermissionManager({ prompt: async () => 'allow_once' }); const registry = new ToolRegistry();
    const manager = new MCPManager(registry, permissions);
    try {
      await manager.start(config()); expect(manager.status()[0].state).toBe('connected');
      const name = registry.descriptors()[0].name; const seen: AgentChatRequest[] = [];
      const provider: LLMProvider = { id: 'fixture-model', async chat(request): Promise<AgentChatResponse> {
        seen.push(request);
        return seen.length === 1 ? { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'remote1', name, arguments: '{"text":"Hello through MCP"}' }] } : { content: '完成', finishReason: 'stop' };
      } };
      const executor = new ToolExecutor(registry, new WorkspaceService(), { permissions });
      const output = await new AgentLoop({ provider, registry, executor }).run({ message: 'Use the external echo tool' });
      expect(output).toMatchObject({ status: 'completed', finalAnswer: '完成', toolCalls: 1 });
      const feedback = seen[1].messages.find((message) => message.role === 'tool'); expect(feedback?.content).toContain('Hello through MCP');
    } finally { await manager.stop(); }
  });
});
