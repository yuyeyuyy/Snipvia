import { randomUUID } from 'node:crypto';
import { ToolRegistry } from '../ToolRegistry';
import { PermissionManager, type PermissionSession } from '../PermissionManager';
import { normalizeToolError, ToolError } from '../ToolError';
import { MCPClient, type MCPClientEvents, type MCPConnection } from './MCPClient';
import { MCPToolAdapter } from './MCPToolAdapter';
import { mcpFingerprint, parseMCPConfig, serverEnvironment, type MCPServerConfig } from './config';
import type { ToolErrorCode } from '../types/tool';

export interface MCPServerStatus {
  server: string;
  state: 'disabled' | 'authorizing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'stopped';
  toolCount: number;
  rejectedTools: number;
  reconnectAttempts: number;
  errorCode?: ToolErrorCode;
}
interface Entry {
  config: MCPServerConfig;
  env: Record<string, string>;
  identity: string;
  status: MCPServerStatus;
  lifetime: AbortController;
  client?: MCPConnection;
  unregister: Array<() => void>;
  catalog?: { active: boolean };
  version: number;
  refreshing: boolean;
  retry?: ReturnType<typeof setTimeout>;
  refreshTimer?: ReturnType<typeof setTimeout>;
}
export interface MCPManagerOptions {
  onStatus?(status: MCPServerStatus): void;
  clientFactory?(config: MCPServerConfig, env: Record<string, string>, events: MCPClientEvents): MCPConnection;
}

/** Main-only owner. AgentLoop sees only registry descriptors and never imports MCP. */
export class MCPManager {
  private readonly entries = new Map<string, Entry>();
  private readonly session: PermissionSession;
  private started = false;
  private stopped = false;
  private closing?: Promise<void>;
  constructor(private readonly registry: ToolRegistry, private readonly permissions: PermissionManager, private readonly options: MCPManagerOptions = {}) {
    this.session = permissions.createSession();
  }
  async start(input: unknown): Promise<void> {
    if (this.started || this.stopped) throw new ToolError('INVALID_INPUT', 'MCPManager 已启动或关闭');
    const config = parseMCPConfig(input);
    this.started = true;
    // Serial approval avoids a burst of permission windows; app startup does not await this method.
    for (const [server, settings] of Object.entries(config.mcpServers)) {
      if (this.stopped) break;
      await this.startServer(server, settings);
    }
  }
  status(): MCPServerStatus[] { return [...this.entries.values()].map((entry) => ({ ...entry.status })); }
  async disconnect(server: string): Promise<void> {
    const entry = this.entries.get(server);
    if (!entry) throw new ToolError('NOT_FOUND', 'MCP Server 未配置');
    this.invalidate(entry);
    this.update(entry, { state: 'disconnected' });
    await entry.client?.close();
  }
  async reconnect(server: string): Promise<void> {
    if (this.stopped) throw new ToolError('MCP_DISCONNECTED', 'MCPManager 已关闭');
    const entry = this.entries.get(server);
    if (!entry) throw new ToolError('NOT_FOUND', 'MCP Server 未配置');
    await this.disconnect(server);
    if (!this.stopped && this.entries.get(server) === entry) await this.startServer(server, entry.config);
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.permissions.endSession(this.session);
    const entries = [...this.entries.values()];
    for (const entry of entries) { this.invalidate(entry); this.update(entry, { state: 'stopped' }); }
    this.closing = Promise.allSettled(entries.map((entry) => entry.client?.close())).then(() => {});
    return this.closing;
  }
  private async startServer(server: string, config: MCPServerConfig): Promise<void> {
    config = { ...config, cwd: config.cwd ?? process.cwd() };
    const entry: Entry = { config, env: {}, identity: '', lifetime: new AbortController(), unregister: [], version: 0, refreshing: false,
      status: { server, state: config.enabled ? 'authorizing' : 'disabled', toolCount: 0, rejectedTools: 0, reconnectAttempts: 0 } };
    this.entries.set(server, entry); this.update(entry, {});
    if (!config.enabled) return;
    try {
      entry.env = serverEnvironment(config);
      entry.identity = mcpFingerprint([server, config, entry.env]);
      await this.permissions.authorize({ toolCallId: randomUUID(), toolName: 'mcp_connect', permission: 'external:execute',
        external: { server, tool: '启动及自动重连', fingerprint: entry.identity }, workspaceId: 'mcp-servers', workspacePath: '',
        input: { server, command: config.command, args: config.args, cwd: config.cwd,
          environmentKeys: Object.keys(entry.env), maxReconnectAttempts: config.reconnect.maxAttempts } }, entry.lifetime.signal, { session: this.session });
      if (this.active(entry)) await this.connect(entry);
    } catch (error) {
      if (this.active(entry)) this.update(entry, { state: 'failed', errorCode: normalizeToolError(error).code });
    }
  }
  private async connect(entry: Entry): Promise<void> {
    if (!this.active(entry)) return;
    entry.version++;
    this.update(entry, { state: 'connecting', errorCode: undefined });
    let client: MCPConnection | undefined;
    const events: MCPClientEvents = {
      disconnected: () => {
        if (!this.active(entry) || entry.client !== client || entry.status.state !== 'connected') return;
        this.dropTools(entry);
        this.retry(entry, new ToolError('MCP_DISCONNECTED', 'MCP Server 已断开'));
      },
      toolsChanged: () => {
        if (!this.active(entry) || entry.client !== client) return;
        entry.version++; this.dropTools(entry);
        if (entry.status.state === 'connected') this.scheduleRefresh(entry);
      }
    };
    try {
      await entry.client?.close();
      if (!this.active(entry)) return;
      client = (this.options.clientFactory ?? ((config, env, callbacks) => new MCPClient(config, env, callbacks)))(entry.config, entry.env, events);
      entry.client = client;
      await client.connect(entry.lifetime.signal);
      if (!this.active(entry)) { await client.close(); return; }
      await this.refresh(entry);
      if (!this.active(entry)) return;
      this.update(entry, { state: 'connected', errorCode: undefined });
      if (!entry.catalog) this.scheduleRefresh(entry);
    } catch (error) {
      await client?.close();
      if (this.active(entry)) this.retry(entry, error);
    }
  }
  private retry(entry: Entry, error: unknown): void {
    entry.version++;
    this.dropTools(entry);
    if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
    entry.refreshTimer = undefined;
    const errorCode = normalizeToolError(error).code;
    if (entry.status.reconnectAttempts >= entry.config.reconnect.maxAttempts) {
      this.update(entry, { state: 'failed', errorCode }); return;
    }
    const attempt = entry.status.reconnectAttempts + 1;
    this.update(entry, { state: 'reconnecting', reconnectAttempts: attempt, errorCode });
    entry.retry = setTimeout(() => {
      entry.retry = undefined;
      if (this.active(entry)) void this.connect(entry);
    }, Math.min(30_000, entry.config.reconnect.initialDelayMs * 2 ** (attempt - 1)));
    entry.retry.unref();
  }
  private scheduleRefresh(entry: Entry): void {
    if (entry.refreshTimer || entry.refreshing) return;
    entry.refreshTimer = setTimeout(() => {
      entry.refreshTimer = undefined;
      if (!this.active(entry) || entry.status.state !== 'connected') return;
      const client = entry.client;
      void this.refresh(entry).catch(async (error: unknown) => {
        if (!this.active(entry) || entry.client !== client || entry.status.state !== 'connected') return;
        // Avoid onclose scheduling a second retry.
        this.update(entry, { state: 'connecting' });
        await entry.client?.close();
        if (this.active(entry)) this.retry(entry, error);
      });
    }, 250);
    entry.refreshTimer.unref();
  }
  private async refresh(entry: Entry): Promise<void> {
    const client = entry.client!; const version = entry.version;
    entry.refreshing = true;
    try {
      const definitions = await client.listTools(entry.lifetime.signal);
      if (!this.active(entry) || entry.client !== client || version !== entry.version ||
          (entry.status.state !== 'connected' && entry.status.state !== 'connecting')) return;
      const token = { active: true };
      const identity = `${entry.identity}:${randomUUID()}`;
      const tools = []; let rejectedTools = 0;
      for (const definition of definitions) {
        try {
          tools.push(MCPToolAdapter.create(entry.status.server, identity, definition,
            (name, input, signal) => client.callTool(name, input, AbortSignal.any([signal, entry.lifetime.signal])),
            () => this.active(entry) && entry.client === client && token.active));
        } catch { rejectedTools++; }
      }
      this.dropTools(entry);
      entry.catalog = token;
      try { for (const tool of tools) entry.unregister.push(this.registry.register(tool)); }
      catch (error) { this.dropTools(entry); throw error; }
      this.update(entry, { toolCount: tools.length, rejectedTools });
    } finally {
      entry.refreshing = false;
      if (this.active(entry) && entry.client === client && version !== entry.version && entry.status.state === 'connected') this.scheduleRefresh(entry);
    }
  }
  private dropTools(entry: Entry): void {
    if (entry.catalog) entry.catalog.active = false;
    entry.catalog = undefined;
    for (const unregister of entry.unregister.splice(0)) unregister();
    entry.status.toolCount = 0;
  }
  private invalidate(entry: Entry): void {
    entry.version++;
    entry.lifetime.abort(new ToolError('MCP_DISCONNECTED', 'MCP Server 已断开'));
    clearTimeout(entry.retry); clearTimeout(entry.refreshTimer);
    this.dropTools(entry);
  }
  private active(entry: Entry): boolean {
    return !this.stopped && !entry.lifetime.signal.aborted && this.entries.get(entry.status.server) === entry;
  }
  private update(entry: Entry, patch: Partial<MCPServerStatus>): void {
    Object.assign(entry.status, patch);
    try { this.options.onStatus?.({ ...entry.status }); } catch { /* Observers cannot change the connection lifecycle. */ }
  }
}
