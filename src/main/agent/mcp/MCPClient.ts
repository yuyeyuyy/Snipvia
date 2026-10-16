import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema, ListToolsResultSchema, ToolListChangedNotificationSchema, type Tool, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, throwIfAborted } from '../ToolError';
import { BoundedStdioTransport } from './BoundedStdioTransport';
import type { MCPServerConfig } from './config';

export interface MCPConnection {
  connect(signal: AbortSignal): Promise<void>;
  listTools(signal: AbortSignal): Promise<Tool[]>;
  callTool(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}
export interface MCPClientEvents { disconnected(): void; toolsChanged(): void }

export class MCPClient implements MCPConnection {
  private readonly sdk = new Client({ name: 'Snipvia', version: '0.1.0' }, { capabilities: {} });
  private readonly transport: BoundedStdioTransport;
  private readonly lifetime = new AbortController();
  private connected = false;
  private closing = false;
  private activeCalls = 0;
  constructor(private readonly config: MCPServerConfig, env: Record<string, string>, private readonly events: MCPClientEvents) {
    this.transport = new BoundedStdioTransport(config, env);
    this.sdk.onclose = () => {
      this.connected = false;
      this.lifetime.abort(new ToolError('MCP_DISCONNECTED', 'MCP Server 连接已断开；操作结果可能未知，请勿自动重试'));
      if (!this.closing) this.events.disconnected();
    };
    this.sdk.onerror = () => {}; // No protocol payload or stderr in logs.
    this.sdk.setNotificationHandler(ToolListChangedNotificationSchema, () => this.events.toolsChanged());
  }
  async connect(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const deadline = AbortSignal.timeout(this.config.connectTimeoutMs);
    try {
      await this.sdk.connect(this.transport, { signal: AbortSignal.any([signal, this.lifetime.signal, deadline]), timeout: this.config.connectTimeoutMs + 100 });
      throwIfAborted(signal); throwIfAborted(this.lifetime.signal);
      if (!this.sdk.getServerCapabilities()?.tools) throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP Server 未声明 tools 能力');
      this.connected = true;
    } catch (error) {
      const failure = deadline.aborted && !signal.aborted ? new ToolError('TIMEOUT', 'MCP 连接握手超时') : this.failure(error, signal);
      await this.close(); throw failure;
    }
  }
  async listTools(signal: AbortSignal): Promise<Tool[]> {
    this.ensureConnected(signal);
    const deadline = AbortSignal.timeout(this.config.requestTimeoutMs);
    const combined = AbortSignal.any([signal, this.lifetime.signal, deadline]);
    const tools: Tool[] = []; const cursors = new Set<string>(); const names = new Set<string>();
    let cursor: string | undefined;
    let bytes = 0;
    try {
      do {
        const page = await this.sdk.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, ListToolsResultSchema, { signal: combined, timeout: this.config.requestTimeoutMs });
        bytes += Buffer.byteLength(JSON.stringify(page));
        if (bytes > 1024 * 1024 || tools.length + page.tools.length > 128) throw new ToolError('RESPONSE_TOO_LARGE', 'MCP 工具目录超过大小或数量限制');
        for (const tool of page.tools) {
          if (names.has(tool.name)) throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP 工具目录存在重复名称');
          names.add(tool.name); tools.push(tool);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          if (!cursor || cursor.length > 4096 || cursors.has(cursor) || cursors.size >= 16) throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP 工具目录分页无效');
          cursors.add(cursor);
        }
      } while (cursor !== undefined);
      return tools;
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new ToolError('TIMEOUT', 'MCP 工具目录读取超时');
      throw this.failure(error, signal);
    }
  }
  async callTool(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    this.ensureConnected(signal);
    if (this.activeCalls >= 8) throw new ToolError('CALL_IN_PROGRESS', 'MCP Server 并行调用达到上限');
    this.activeCalls++;
    try {
      const result = await this.sdk.request({ method: 'tools/call', params: { name, arguments: input } }, CallToolResultSchema,
        { signal: AbortSignal.any([signal, this.lifetime.signal]), timeout: this.config.requestTimeoutMs, resetTimeoutOnProgress: false });
      throwIfAborted(signal);
      return result;
    } catch (error) { throw this.failure(error, signal); }
    finally { this.activeCalls--; }
  }
  async close(): Promise<void> {
    this.closing = true; this.connected = false;
    this.lifetime.abort(new ToolError('MCP_DISCONNECTED', 'MCP Server 已断开'));
    await this.transport.close();
    await this.sdk.close();
  }
  private ensureConnected(signal: AbortSignal): void {
    throwIfAborted(signal);
    if (!this.connected) throw new ToolError('MCP_DISCONNECTED', 'MCP Server 未连接');
  }
  private failure(error: unknown, signal: AbortSignal): ToolError {
    if (signal.aborted) { try { throwIfAborted(signal); } catch (reason) { return reason as ToolError; } }
    if (error instanceof ToolError) return error;
    if (this.lifetime.signal.aborted) return new ToolError('MCP_DISCONNECTED', 'MCP 连接已断开；操作结果可能未知，请勿自动重试');
    if (error && typeof error === 'object' && 'code' in error && error.code === -32001) return new ToolError('TIMEOUT', 'MCP 请求超时；远端操作可能仍在执行，请勿自动重试');
    return new ToolError('MCP_PROTOCOL_ERROR', 'MCP Server 返回协议错误或无效结果');
  }
}
