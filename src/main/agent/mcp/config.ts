import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '../ToolError';

const value = z.string().max(4096).refine((text) => !text.includes('\0'));
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
export const mcpServerSchema = z.strictObject({
  command: z.string().min(1).max(4096).refine((text) => ![...text].some((char) => char.charCodeAt(0) < 32)),
  args: z.array(value).max(64).default([]),
  cwd: value.refine((text) => path.isAbsolute(text)).optional(),
  env: z.record(envName, value).default({}),
  /** Explicitly forward only named secrets; never inherit the whole Main environment. */
  envFrom: z.record(envName, envName).default({}),
  enabled: z.boolean().default(true),
  connectTimeoutMs: z.number().int().min(100).max(60_000).default(10_000),
  requestTimeoutMs: z.number().int().min(100).max(60_000).default(10_000),
  reconnect: z.strictObject({
    maxAttempts: z.number().int().min(0).max(10).default(3),
    initialDelayMs: z.number().int().min(100).max(30_000).default(1000)
  }).default({ maxAttempts: 3, initialDelayMs: 1000 })
});
const configuration = z.strictObject({ mcpServers: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/), mcpServerSchema)
  .refine((servers) => Object.keys(servers).length <= 16) });
export type MCPServerConfig = z.infer<typeof mcpServerSchema>;
export type MCPConfig = z.infer<typeof configuration>;
export function parseMCPConfig(input: unknown): MCPConfig {
  const parsed = configuration.safeParse(input);
  if (!parsed.success) throw new ToolError('MCP_CONFIG_INVALID', 'MCP 配置无效，请检查 command、args 和超时配置');
  return parsed.data;
}
export async function loadMCPConfig(file: string): Promise<MCPConfig> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('size');
    const buffer = Buffer.alloc(128 * 1024 + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > 128 * 1024) throw new Error('size');
    return parseMCPConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total))));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { mcpServers: {} };
    throw new ToolError('MCP_CONFIG_INVALID', 'MCP 配置读取失败；未启动任何 Server');
  } finally { await handle?.close(); }
}
export function mcpFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function serverEnvironment(config: MCPServerConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  for (const [key, source] of Object.entries(config.envFrom)) {
    if (process.env[source] === undefined) throw new ToolError('MCP_CONFIG_INVALID', 'MCP 指定的环境变量不存在');
    env[key] = process.env[source]!;
  }
  return { ...env, ...config.env };
}
