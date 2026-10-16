import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, defineTool } from '../../src/main/agent/ToolRegistry';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { WorkspaceService } from '../../src/main/agent/WorkspaceService';
import { PermissionManager } from '../../src/main/agent/PermissionManager';
import { MCPToolAdapter, normalizeMCPResult } from '../../src/main/agent/mcp/MCPToolAdapter';
import { MCPManager } from '../../src/main/agent/mcp/MCPManager';
import { loadMCPConfig, parseMCPConfig, serverEnvironment } from '../../src/main/agent/mcp/config';
import type { MCPClientEvents, MCPConnection } from '../../src/main/agent/mcp/MCPClient';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PermissionRequest } from '../../src/shared/agent/permission';
import { z } from 'zod';

const definition: Tool = { name: 'read_file', description: 'External read', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, annotations: { readOnlyHint: true } };
const result: CallToolResult = { content: [{ type: 'text', text: 'answer' }] };
const managers: MCPManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map((manager) => manager.stop())); vi.useRealTimers(); vi.unstubAllEnvs(); });

function harness(prompt: (request: PermissionRequest) => Promise<'allow_once' | 'allow_session' | 'deny'> = async () => 'allow_once') {
  const registry = new ToolRegistry(); const permissions = new PermissionManager({ prompt });
  const executor = new ToolExecutor(registry, new WorkspaceService(), { permissions });
  const created: Array<{ client: MCPConnection; events: MCPClientEvents }> = [];
  const manager = new MCPManager(registry, permissions, { clientFactory: (_config, _env, events) => {
    const client: MCPConnection = { connect: vi.fn(async () => {}), listTools: vi.fn(async () => [structuredClone(definition)]), callTool: vi.fn(async () => result), close: vi.fn(async () => {}) };
    created.push({ client, events }); return client;
  } });
  managers.push(manager);
  return { registry, permissions, executor, manager, created };
}
const config = { mcpServers: { github: { command: 'test-server', reconnect: { initialDelayMs: 100, maxAttempts: 2 } } } };

describe('MCP configuration', () => {
  it('normalizes the requested command/args format with bounded defaults', () => {
    expect(parseMCPConfig({ mcpServers: { github: { command: 'node', args: ['server.js'] } } }).mcpServers.github).toMatchObject({ requestTimeoutMs: 10_000, enabled: true });
  });
  it.each([{}, { mcpServers: [] }, { mcpServers: { x: { command: '' } } }, { mcpServers: { x: { command: 'node', cwd: '../escape' } } }, { mcpServers: { x: { command: 'node', transport: 'http' } } }, { mcpServers: { x: { command: 'node', requestTimeoutMs: 0 } } }])('rejects malformed configuration %j', (input) => {
    expect(() => parseMCPConfig(input)).toThrow(expect.objectContaining({ code: 'MCP_CONFIG_INVALID' }));
  });
  it('does not inherit Main secrets and supports explicit env forwarding', () => {
    vi.stubEnv('SNIPVIA_TEST_SECRET', 'private'); vi.stubEnv('TEST_MCP_VALUE', 'forwarded');
    const settings = parseMCPConfig({ mcpServers: { x: { command: 'node', envFrom: { API_KEY: 'TEST_MCP_VALUE' } } } }).mcpServers.x;
    expect(serverEnvironment(settings)).toMatchObject({ API_KEY: 'forwarded' });
    expect(serverEnvironment(settings)).not.toHaveProperty('SNIPVIA_TEST_SECRET');
    settings.envFrom = { KEY: 'SNIPVIA_NONEXISTENT_TEST_VARIABLE' };
    expect(() => serverEnvironment(settings)).toThrow();
  });
  it('reads only bounded regular config files and allows an absent file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'snipvia-mcp-config-'));
    try {
      const file = join(directory, 'servers.json');
      expect(await loadMCPConfig(file)).toEqual({ mcpServers: {} });
      await writeFile(file, JSON.stringify(config)); expect((await loadMCPConfig(file)).mcpServers.github.command).toBe('test-server');
      await symlink(file, join(directory, 'link')); await expect(loadMCPConfig(join(directory, 'link'))).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' });
      await writeFile(file, 'x'.repeat(128 * 1024 + 1)); await expect(loadMCPConfig(file)).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' });
      await writeFile(file, '{'); await expect(loadMCPConfig(file)).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('MCP tool adapter and permission boundary', () => {
  it('namespaces tools without collisions and does not trust readOnlyHint', async () => {
    const prompts: PermissionRequest[] = []; const permissions = new PermissionManager({ prompt: async (request) => { prompts.push(request); return 'deny'; } });
    const registry = new ToolRegistry(); const call = vi.fn(async () => result);
    registry.register(defineTool({ name: 'read_file', description: 'builtin', permission: 'workspace:read', schema: z.object({}), execute: async () => ({ success: true, output: '' }) }));
    const tool = MCPToolAdapter.create('github', 'connection', definition, call, () => true);
    const other = MCPToolAdapter.create('other', 'connection', definition, call, () => true);
    registry.register(tool); registry.register(other);
    expect(new Set(registry.descriptors().map((tool) => tool.name)).size).toBe(3); expect(tool.name.length).toBeLessThanOrEqual(64);
    const executor = new ToolExecutor(registry, new WorkspaceService(), { permissions });
    expect(await executor.execute({ id: '1', name: tool.name, input: { text: 'hello' } })).toMatchObject({ error: { code: 'APPROVAL_DENIED' } });
    expect(call).not.toHaveBeenCalled(); expect(prompts[0]).toMatchObject({ risk: 'DANGEROUS', target: 'github / read_file' });
    expect(prompts[0].allowedDecisions).not.toContain('always_allow');
  });
  it('validates arguments before approval and invokes only through executor after confirmation', async () => {
    const prompt = vi.fn(async () => 'allow_once' as const); const h = harness(prompt); await h.manager.start(config);
    const name = h.registry.descriptors()[0].name; prompt.mockClear();
    expect(await h.executor.execute({ id: 'a', name, input: { text: 123 } })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(prompt).not.toHaveBeenCalled(); expect(h.created[0].client.callTool).not.toHaveBeenCalled();
    expect(await h.executor.execute({ id: 'b', name, input: { text: 'hello' } })).toMatchObject({ success: true, output: { text: 'answer', source: 'untrusted_mcp' } });
    expect(prompt).toHaveBeenCalledOnce(); expect(h.created[0].client.callTool).toHaveBeenCalledWith('read_file', { text: 'hello' }, expect.any(AbortSignal));
  });
  it('fails closed without an approval UI', async () => {
    const registry = new ToolRegistry(); const call = vi.fn(async () => result);
    const tool = MCPToolAdapter.create('server', 'v1', definition, call, () => true); registry.register(tool);
    const executor = new ToolExecutor(registry, new WorkspaceService());
    expect(await executor.execute({ id: 'a', name: tool.name, input: { text: 'x' } })).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
    expect(call).not.toHaveBeenCalled();
  });
  it('invalidates pending approval when the remote catalog changes', async () => {
    let approve: (() => void) | undefined;
    const h = harness(async (request) => request.toolName === 'mcp_connect' ? 'allow_once' : new Promise((resolve) => { approve = () => resolve('allow_once'); }));
    await h.manager.start(config); const name = h.registry.descriptors()[0].name;
    const pending = h.executor.execute({ id: 'a', name, input: { text: 'x' } });
    await vi.waitFor(() => expect(approve).toBeDefined()); h.created[0].events.toolsChanged(); approve!();
    expect(await pending).toMatchObject({ error: { code: 'MCP_DISCONNECTED' } }); expect(h.created[0].client.callTool).not.toHaveBeenCalled();
  });
  it('binds session grants to connection fingerprint and exact arguments', async () => {
    const prompt = vi.fn(async () => 'allow_session' as const); const h = harness(prompt); await h.manager.start(config);
    const session = h.permissions.createSession(); const name = h.registry.descriptors()[0].name; prompt.mockClear();
    await h.executor.execute({ id: 'a', name, input: { text: 'x' } }, { session });
    await h.executor.execute({ id: 'b', name, input: { text: 'x' } }, { session }); expect(prompt).toHaveBeenCalledTimes(1);
    await h.executor.execute({ id: 'c', name, input: { text: 'y' } }, { session }); expect(prompt).toHaveBeenCalledTimes(2);
    await h.manager.reconnect('github'); prompt.mockClear();
    await h.executor.execute({ id: 'd', name, input: { text: 'x' } }, { session }); expect(prompt).toHaveBeenCalledTimes(1);
    h.permissions.endSession(session);
  });
  it.each([
    { type: 'object', properties: { x: { $ref: 'https://internal/schema' } } },
    { type: 'object', properties: { x: { type: 'string', pattern: '(a+)+$' } } },
    { type: 'object', $async: true },
    { type: 'object', $schema: 'https://invalid/schema' }
  ])('rejects unsafe or unsupported schemas %j', (schema) => {
    expect(() => MCPToolAdapter.create('x', 'v1', { ...definition, inputSchema: { ...schema, type: 'object' } }, async () => result, () => true)).toThrow();
  });
  it('supports local references and draft-07 without coercion or defaults', () => {
    const tool = MCPToolAdapter.create('x', 'v1', { ...definition, inputSchema: { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#', definitions: { text: { type: 'string' } }, properties: { text: { $ref: '#/definitions/text' } }, required: ['text'] } }, async () => result, () => true);
    expect(tool.parseInput({ text: 'hello' })).toEqual({ text: 'hello' }); expect(() => tool.parseInput({ text: 1 })).toThrow();
  });
  it('accepts schema property names that happen to be keywords', () => {
    const tool = MCPToolAdapter.create('x', 'v1', { ...definition, inputSchema: {
      type: 'object', properties: { pattern: { type: 'string' }, $ref: { type: 'string' } }
    } }, async () => result, () => true);
    expect(tool.parseInput({ pattern: 'normal property', $ref: 'ordinary value' })).toHaveProperty('pattern');
  });
  it('bounds output including JSON escaping, drops binary, and preserves tool errors', () => {
    const output = normalizeMCPResult({ content: [{ type: 'text', text: '"\\\n你😀'.repeat(10_000) }, { type: 'image', mimeType: 'image/png', data: 'secret-base64' }] });
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(7500); expect(output).toMatchObject({ success: true, output: { truncated: true, omittedBlocks: 1 } }); expect(JSON.stringify(output)).not.toContain('secret-base64');
    expect(normalizeMCPResult({ content: [{ type: 'text', text: 'missing' }], isError: true })).toMatchObject({ error: { code: 'MCP_TOOL_ERROR', message: 'missing' } });
    expect(Buffer.byteLength(JSON.stringify(normalizeMCPResult({ content: [{ type: 'text', text: '\0'.repeat(10_000) }], isError: true })))).toBeLessThan(7000);
  });
  it('keeps old unregister receipts from deleting replacement tools', () => {
    const registry = new ToolRegistry(); const tool = MCPToolAdapter.create('x', 'v1', definition, async () => result, () => true);
    const remove = registry.register(tool); remove(); registry.register(tool); remove(); expect(registry.descriptors()).toHaveLength(1);
  });
});

describe('MCP manager lifecycle', () => {
  it('requires launch approval, skips disabled servers and never spawns after denial', async () => {
    const h = harness(async () => 'deny'); await h.manager.start({ mcpServers: { ...config.mcpServers, disabled: { command: 'node', enabled: false } } });
    expect(h.created).toHaveLength(0); expect(h.manager.status().map((item) => item.state)).toEqual(['failed', 'disabled']); expect(h.registry.descriptors()).toHaveLength(0);
  });
  it('removes tools on crash, reconnects with backoff and bounds repeated crashes', async () => {
    vi.useFakeTimers(); const h = harness(); await h.manager.start(config);
    h.created[0].events.disconnected(); expect(h.registry.descriptors()).toHaveLength(0); expect(h.manager.status()[0].state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100); expect(h.created).toHaveLength(2); expect(h.registry.descriptors()).toHaveLength(1);
    h.created[1].events.disconnected(); await vi.advanceTimersByTimeAsync(200); expect(h.created).toHaveLength(3);
    h.created[2].events.disconnected(); await vi.advanceTimersByTimeAsync(10_000); expect(h.created).toHaveLength(3); expect(h.manager.status()[0].state).toBe('failed');
    expect(h.created.every(({ client }) => vi.mocked(client.callTool).mock.calls.length === 0)).toBe(true);
  });
  it('refreshes catalogs and changes names if schemas/descriptions change', async () => {
    vi.useFakeTimers(); const h = harness(); await h.manager.start(config); const oldName = h.registry.descriptors()[0].name;
    vi.mocked(h.created[0].client.listTools).mockResolvedValue([{ ...definition, description: 'changed' }]); h.created[0].events.toolsChanged();
    expect(h.registry.descriptors()).toHaveLength(0); await vi.advanceTimersByTimeAsync(250);
    expect(h.registry.descriptors()[0].name).not.toBe(oldName);
  });
  it('stops reconnect timers and removes only its own tools', async () => {
    vi.useFakeTimers(); const h = harness(); h.registry.register(defineTool({ name: 'builtin', description: 'test', permission: 'workspace:read', schema: z.object({}), execute: async () => ({ success: true, output: '' }) }));
    await h.manager.start(config); h.created[0].events.disconnected(); await h.manager.stop(); await vi.advanceTimersByTimeAsync(30_000);
    expect(h.created).toHaveLength(1); expect(h.registry.descriptors().map((tool) => tool.name)).toEqual(['builtin']); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not publish a catalog that arrives after disconnect', async () => {
    const h = harness(); await h.manager.start(config); await h.manager.disconnect('github');
    h.created[0].events.toolsChanged(); expect(h.registry.descriptors()).toHaveLength(0); expect(h.manager.status()[0].state).toBe('disconnected');
  });
  it('does not revive tools from a refresh result arriving after a crash', async () => {
    const h = harness(); await h.manager.start(config);
    let deliver: ((tools: Tool[]) => void) | undefined;
    vi.mocked(h.created[0].client.listTools).mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    h.created[0].events.toolsChanged();
    await vi.waitFor(() => expect(deliver).toBeDefined());
    h.created[0].events.disconnected(); deliver!([definition]);
    await Promise.resolve(); await Promise.resolve();
    expect(h.manager.status()[0].state).toBe('reconnecting'); expect(h.registry.descriptors()).toHaveLength(0);
  });
  it('does not revive tools from a refresh result arriving after manual disconnect', async () => {
    const h = harness(); await h.manager.start(config);
    let deliver: ((tools: Tool[]) => void) | undefined;
    vi.mocked(h.created[0].client.listTools).mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    h.created[0].events.toolsChanged(); await vi.waitFor(() => expect(deliver).toBeDefined());
    await h.manager.disconnect('github'); deliver!([definition]); await Promise.resolve(); await Promise.resolve();
    expect(h.registry.descriptors()).toHaveLength(0);
  });
  it('aborts a pending launch approval on shutdown without spawning', async () => {
    const h = harness(async () => new Promise(() => {})); const starting = h.manager.start(config);
    await Promise.resolve(); await h.manager.stop(); await starting; expect(h.created).toHaveLength(0); expect(h.manager.status()[0].state).toBe('stopped');
  });
  it('skips invalid schemas but keeps valid tools and reports rejected count', async () => {
    vi.useFakeTimers(); const h = harness(); await h.manager.start(config);
    vi.mocked(h.created[0].client.listTools).mockResolvedValue([definition, { ...definition, name: 'bad', inputSchema: { type: 'object', $async: true } }]);
    h.created[0].events.toolsChanged(); await vi.advanceTimersByTimeAsync(250);
    expect(h.manager.status()[0]).toMatchObject({ toolCount: 1, rejectedTools: 1 });
  });
});
