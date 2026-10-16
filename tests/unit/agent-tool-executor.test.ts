import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolError } from '../../src/main/agent/ToolError';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { defineTool, ToolRegistry } from '../../src/main/agent/ToolRegistry';
import { registerReadOnlyTools } from '../../src/main/agent/registerReadOnlyTools';
import { WorkspaceService, type WorkspaceGrant } from '../../src/main/agent/WorkspaceService';
import type { ToolContext, ToolDefinition, ToolLifecycleEvent, ToolResult } from '../../src/main/agent/types/tool';

let directory: string;
let workspace: WorkspaceGrant;
let workspaces: WorkspaceService;
let registry: ToolRegistry;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'snipvia-tool-executor-'));
  await writeFile(path.join(directory, 'test.txt'), 'workspace text');
  workspaces = new WorkspaceService();
  workspace = await workspaces.authorizeWorkspace(directory);
  registry = new ToolRegistry();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

function testTool(execute: (input: { value: string }, context: ToolContext) => Promise<ToolResult<string>>) {
  return defineTool({ name: 'test_tool', description: '测试工具', permission: 'workspace:read',
    schema: z.strictObject({ value: z.string().default('default') }), execute });
}

const call = { id: 'call_1', name: 'test_tool', input: {} };

describe('ToolRegistry', () => {
  it('exposes model-facing schemas without executable functions and rejects duplicate names', () => {
    registerReadOnlyTools(registry);
    const descriptors = registry.descriptors();
    expect(descriptors.map((item) => item.name)).toEqual(['read_file', 'list_directory', 'search_files']);
    expect(descriptors[0]).toMatchObject({ permission: 'workspace:read', inputSchema: {
      type: 'object', required: ['path'], additionalProperties: false
    } });
    expect(descriptors[0]).not.toHaveProperty('execute');
    expect(descriptors[0]).not.toHaveProperty('invoke');
    descriptors[0].inputSchema.properties = {};
    expect(registry.descriptors()[0].inputSchema.properties).toHaveProperty('path');
    expect(() => registerReadOnlyTools(registry)).toThrow(expect.objectContaining({ code: 'DUPLICATE_TOOL' }));
  });

  it('rejects invalid names and permissions instead of silently allowing future write tools', () => {
    const tool = testTool(async () => ({ success: true, output: 'done' }));
    expect(() => registry.register({ ...tool, name: '../exec' })).toThrow(ToolError);
    expect(() => registry.register({ ...tool, permission: 'workspace:write' } as unknown as ToolDefinition)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
  });
});

describe('ToolExecutor lifecycle', () => {
  it('validates arguments before tool execution and supplies defaults', async () => {
    const execute = vi.fn(async (input: { value: string }) => ({ success: true as const, output: input.value }));
    registry.register(testTool(execute));
    const executor = new ToolExecutor(registry, workspaces);
    expect(await executor.execute({ ...call, input: { value: 42 } }, { workspace })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(execute).not.toHaveBeenCalled();
    expect(await executor.execute(call, { workspace })).toMatchObject({ success: true, output: 'default' });
    expect(execute).toHaveBeenCalledOnce();
    expect(await executor.execute({ ...call, name: 'unknown' }, { workspace })).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
    expect(await executor.execute({ ...call, id: '' }, { workspace })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('records one start/end, overrides tool timing, and isolates throwing observers', async () => {
    const events: ToolLifecycleEvent[] = [];
    registry.register(testTool(async () => ({ success: true, output: 'done', metadata: {
      durationMs: -1, toolCallId: 'fake', toolName: 'fake'
    } })));
    const executor = new ToolExecutor(registry, workspaces, { onEvent(event) { events.push(event); throw new Error('observer'); } });
    const result = await executor.execute(call, { workspace });
    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({ toolCallId: call.id, toolName: call.name });
    expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0);
    expect(events.map((event) => event.type)).toEqual(['started', 'completed']);
    expect(events[1]).not.toHaveProperty('output');
  });

  it('normalizes thrown errors and rejects malformed tool results', async () => {
    registry.register(testTool(async () => { throw new Error('/private/secret API_KEY=value'); }));
    const executor = new ToolExecutor(registry, workspaces);
    const result = await executor.execute(call, { workspace });
    expect(result).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR', message: '工具执行失败' } });
    expect(JSON.stringify(result)).not.toContain('API_KEY');
    const invalid = testTool(async () => ({ success: true } as ToolResult<string>));
    registry.register({ ...invalid, name: 'invalid' });
    expect(await executor.execute({ ...call, name: 'invalid' }, { workspace })).toMatchObject({ error: { code: 'INVALID_RESULT' } });
  });

  it('does not invoke a tool when already aborted or unauthorized', async () => {
    const execute = vi.fn(async () => ({ success: true as const, output: 'done' }));
    registry.register(testTool(execute));
    const executor = new ToolExecutor(registry, workspaces);
    expect(await executor.execute(call, { workspace, signal: AbortSignal.abort() })).toMatchObject({ error: { code: 'ABORTED' } });
    expect(await executor.execute(call)).toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('times out a noncooperative tool, aborts its context and ignores late rejection', async () => {
    vi.useFakeTimers();
    let context: ToolContext | undefined;
    let rejectLate: (error: Error) => void = () => {};
    const events: ToolLifecycleEvent[] = [];
    registry.register(testTool(async (_input, received) => {
      context = received;
      return new Promise((_resolve, reject) => { rejectLate = reject; });
    }));
    const executor = new ToolExecutor(registry, workspaces, { timeoutMs: 100, onEvent: (event) => events.push(event) });
    const running = executor.execute(call, { workspace });
    await vi.advanceTimersByTimeAsync(100);
    expect(await running).toMatchObject({ error: { code: 'TIMEOUT' } });
    expect(context!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    rejectLate(new Error('late failure'));
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual(['started', 'completed']);
    await expect(context!.workspace.readText('test.txt', 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it.each(['signal', 'cancel', 'cancelAll', 'revoke'] as const)('cancels in-flight execution with %s', async (method) => {
    let context: ToolContext | undefined;
    const abort = new AbortController();
    registry.register(testTool(async (_input, received) => {
      context = received;
      return new Promise((_resolve, reject) => received.signal.addEventListener('abort', () => reject(received.signal.reason), { once: true }));
    }));
    const executor = new ToolExecutor(registry, workspaces);
    const running = executor.execute(call, { workspace, signal: abort.signal });
    await vi.waitFor(() => expect(context).toBeDefined());
    if (method === 'signal') abort.abort();
    else if (method === 'cancel') executor.cancel(call.id);
    else if (method === 'cancelAll') executor.cancelAll();
    else workspaces.revoke(workspace);
    expect(await running).toMatchObject({ error: { code: method === 'revoke' ? 'PERMISSION_DENIED' : 'ABORTED' } });
    expect(context!.signal.aborted).toBe(true);
  });

  it('rejects duplicate active IDs and keeps cancellation isolated between calls', async () => {
    registry.register(testTool(async (_input, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
    })));
    const executor = new ToolExecutor(registry, workspaces);
    const first = executor.execute(call, { workspace });
    const second = executor.execute({ ...call, id: 'call_2' }, { workspace });
    const secondCompleted = vi.fn();
    void second.then(secondCompleted);
    expect(await executor.execute(call, { workspace })).toMatchObject({ error: { code: 'CALL_IN_PROGRESS' } });
    executor.cancel(call.id);
    expect(await first).toMatchObject({ error: { code: 'ABORTED' } });
    expect(secondCompleted).not.toHaveBeenCalled();
    executor.cancel('call_2');
    expect(await second).toMatchObject({ error: { code: 'ABORTED' } });
  });

  it('expires retained workspace access at completion and removes abort listeners/timers', async () => {
    vi.useFakeTimers();
    let context: ToolContext | undefined;
    registry.register(testTool(async (_input, received) => { context = received; return { success: true, output: 'done' }; }));
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, 'removeEventListener');
    const executor = new ToolExecutor(registry, workspaces);
    expect(await executor.execute(call, { workspace, signal })).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(context!.workspace.readText('test.txt', 100)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('only accepts bounded timeouts configured by trusted Main', async () => {
    registry.register(testTool(async () => ({ success: true, output: 'done' })));
    expect(() => new ToolExecutor(registry, workspaces, { timeoutMs: Infinity })).toThrow(ToolError);
    const executor = new ToolExecutor(registry, workspaces, { timeoutMs: 100 });
    for (const timeoutMs of [0, -1, 101, NaN]) {
      expect(await executor.execute(call, { workspace, timeoutMs })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    }
  });
});
