import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServerConfig } from './config';
import { ToolError } from '../ToolError';

/** Official SDK protocol with a bounded pipe transport. No shell, inherited secrets or raw stderr logs. */
export class BoundedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private started = false;
  private closed = false;
  private closing?: Promise<void>;
  private messages = 0;
  private windowStarted = Date.now();
  private pendingWrites = 0;
  private killTimer?: ReturnType<typeof setTimeout>;
  readonly maxMessageBytes = 1024 * 1024;

  constructor(private readonly config: MCPServerConfig, private readonly env: Record<string, string>) {}
  async start(): Promise<void> {
    if (this.started || this.closed) throw new ToolError('MCP_DISCONNECTED', 'MCP 连接已使用或关闭');
    this.started = true;
    // .cmd/.bat need a shell on Windows. Require an executable + argv instead of implicitly enabling one.
    if (/\.(?:cmd|bat)$/i.test(this.config.command)) throw new ToolError('MCP_CONFIG_INVALID', '请使用可执行程序和 args；不支持通过 shell 启动批处理');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.command, this.config.args, {
        env: this.env, cwd: this.config.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      child.once('spawn', resolve);
      child.on('error', () => {
        const error = new ToolError('MCP_DISCONNECTED', 'MCP Server 启动或通信失败');
        reject(error); this.fail(error);
      });
      child.on('exit', () => this.finish());
      child.stdout.on('end', () => this.fail(new ToolError('MCP_DISCONNECTED', 'MCP stdout 已结束')));
      child.stdout.on('error', () => this.fail(new ToolError('MCP_DISCONNECTED', 'MCP stdout 已关闭')));
      child.stdin.on('error', () => this.fail(new ToolError('MCP_DISCONNECTED', 'MCP stdin 已关闭')));
      child.stderr.on('error', () => {});
      child.stderr.resume(); // Drain, but never store/print tokens or private tool data from stderr.
      child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    });
  }
  private receive(chunk: Buffer): void {
    if (this.closed) return;
    // Check segments BEFORE buffering. A server cannot grow an unterminated JSON line indefinitely.
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (this.buffer.length + end - offset > this.maxMessageBytes) {
        this.fail(new ToolError('RESPONSE_TOO_LARGE', 'MCP 单条消息超过 1 MiB')); return;
      }
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)]);
      if (newline < 0) return;
      if (Date.now() - this.windowStarted >= 1000) { this.messages = 0; this.windowStarted = Date.now(); }
      if (++this.messages > 256) { this.fail(new ToolError('MCP_PROTOCOL_ERROR', 'MCP 消息频率超过上限')); return; }
      try {
        const message = JSONRPCMessageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer)));
        this.buffer = Buffer.alloc(0);
        this.onmessage?.(message);
      } catch { this.fail(new ToolError('MCP_PROTOCOL_ERROR', 'MCP stdout 必须为逐行 JSON-RPC 消息')); return; }
      offset = newline + 1;
      if (this.closed) return;
    }
  }
  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.child;
    if (this.closed || !child || child.stdin.destroyed) throw new ToolError('MCP_DISCONNECTED', 'MCP Server 未连接');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > this.maxMessageBytes || this.pendingWrites >= 64) throw new ToolError('RESPONSE_TOO_LARGE', 'MCP 发送队列或消息超过上限');
    this.pendingWrites++;
    try { await new Promise<void>((resolve, reject) => child.stdin.write(line, (error) => error ? reject(new ToolError('MCP_DISCONNECTED', 'MCP 发送失败')) : resolve())); }
    finally { this.pendingWrites--; }
  }
  private fail(error: ToolError): void {
    if (this.closed) return;
    this.onerror?.(error);
    void this.close();
  }
  private finish(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.buffer = Buffer.alloc(0);
    if (!this.closed) { this.closed = true; this.onclose?.(); }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const child = this.child;
    this.finish(); // Immediately reject pending SDK calls; shutdown itself stays bounded.
    this.closing = new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return; }
      const done = () => { if (this.killTimer) clearTimeout(this.killTimer); resolve(); };
      child.once('exit', done);
      child.stdin.destroy();
      child.kill('SIGTERM');
      this.killTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 500);
    });
    return this.closing;
  }
}
