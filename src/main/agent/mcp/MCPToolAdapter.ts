import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, throwIfAborted } from '../ToolError';
import type { ExternalToolDefinition, ToolResult, JSONSchema, ToolContext } from '../types/tool';
import { utf8Prefix } from '../web/operation';
import { mcpFingerprint } from './config';

/** Bound untrusted schema/input complexity before compilation or recursive validation. */
function boundedJSON(value: unknown, maxBytes: number): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 32) throw new ToolError('INVALID_INPUT', 'MCP JSON 层级或节点过多');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object') throw new ToolError('INVALID_INPUT', 'MCP 参数必须是 JSON');
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new ToolError('INVALID_INPUT', 'MCP JSON 超过大小限制');
}
export function compileMCPSchema(schema: Tool['inputSchema']): (input: unknown) => Record<string, unknown> {
  boundedJSON(schema, 32 * 1024);
  const inspect = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const node = item as Record<string, unknown>;
    // Only interpret schema keywords, not similarly named properties or values in const/examples.
    for (const key of ['$async', 'pattern', 'patternProperties', '$dynamicRef', '$recursiveRef']) {
      if (key in node) throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP Schema 含不支持的正则或动态引用');
    }
    if ('$ref' in node && (typeof node.$ref !== 'string' || !node.$ref.startsWith('#'))) {
      throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP Schema 禁止远程引用');
    }
    for (const key of ['properties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']) {
      if (node[key] && typeof node[key] === 'object') for (const child of Object.values(node[key])) inspect(child);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      if (Array.isArray(node[key])) for (const child of node[key]) inspect(child);
    }
    for (const key of ['items', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']) {
      if (Array.isArray(node[key])) for (const child of node[key]) inspect(child);
      else inspect(node[key]);
    }
  };
  inspect(schema);
  if (schema.type !== 'object') throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP inputSchema 必须是 object');
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== 'https://json-schema.org/draft/2020-12/schema' && dialect !== 'http://json-schema.org/draft-07/schema#') {
    throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP Schema dialect 暂不支持');
  }
  const options = { strict: false, validateFormats: false, allErrors: false, ownProperties: true, addUsedSchema: false };
  try {
    const ajv = dialect === 'http://json-schema.org/draft-07/schema#' ? new Ajv(options) : new Ajv2020(options);
    const validate = ajv.compile(schema);
    return (input) => {
      boundedJSON(input, 64 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input) || !validate(input)) throw new ToolError('INVALID_INPUT', 'MCP 工具参数不符合 inputSchema');
      return input as Record<string, unknown>;
    };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP inputSchema 无法校验');
  }
}
export function normalizeMCPResult(result: CallToolResult): ToolResult {
  const text: string[] = [];
  let omitted = 0;
  for (const block of result.content ?? []) {
    if (block.type === 'text') text.push(block.text);
    else if (block.type === 'resource' && 'text' in block.resource) text.push(block.resource.text);
    else if (block.type === 'resource_link') text.push(`[资源链接] ${block.name}: ${block.uri}`);
    else omitted++; // Do not put binary/base64 images, audio or blobs in model context.
  }
  if (result.structuredContent) text.push(JSON.stringify(result.structuredContent));
  const full = text.join('\n\n');
  if (result.isError) {
    let message = utf8Prefix(full || 'MCP 工具执行失败', 2000);
    while (Buffer.byteLength(JSON.stringify(message)) > 6000) message = utf8Prefix(message, Math.floor(Buffer.byteLength(message) * 0.8));
    return { success: false, error: { code: 'MCP_TOOL_ERROR', message } };
  }
  let output = { text: utf8Prefix(full, 5000), truncated: Buffer.byteLength(full) > 5000,
    omittedBlocks: omitted, source: 'untrusted_mcp' as const };
  while (Buffer.byteLength(JSON.stringify(output)) > 7000) output = { ...output, text: utf8Prefix(output.text, Math.floor(Buffer.byteLength(output.text) * 0.8)), truncated: true };
  return { success: true, output };
}

export class MCPToolAdapter {
  static create(server: string, connectionIdentity: string, definition: Tool,
    call: (name: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>,
    available: () => boolean): ExternalToolDefinition<Record<string, unknown>> {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(definition.name) || definition.execution?.taskSupport === 'required') {
      throw new ToolError('MCP_PROTOCOL_ERROR', 'MCP 工具名称无效或需要尚未支持的 tasks 协议');
    }
    const schema = structuredClone(definition.inputSchema);
    const parse = compileMCPSchema(schema);
    const description = utf8Prefix(definition.description ?? definition.name, 2000);
    // Schema/description changes get a different name: an old Agent context cannot call a new contract.
    const revision = mcpFingerprint([server, definition.name, schema, description]);
    const label = `${server}_${definition.name}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 34);
    const name = `mcp_${label}_${revision.slice(0, 24)}`;
    const ensure = () => { if (!available()) throw new ToolError('MCP_DISCONNECTED', 'MCP 工具已失效，请重新读取工具目录'); };
    return Object.freeze({
      name, description: `[MCP ${server}/${definition.name}; external tool, requires approval] ${description}`,
      inputSchema: schema as JSONSchema, permission: 'external:execute' as const,
      external: Object.freeze({ server, tool: definition.name, fingerprint: mcpFingerprint([connectionIdentity, revision]) }),
      parseInput(input: unknown) { ensure(); return parse(input); },
      async execute(input: Record<string, unknown>, context: Pick<ToolContext, 'toolCallId' | 'signal'>) {
        ensure(); throwIfAborted(context.signal);
        return normalizeMCPResult(await call(definition.name, input, context.signal));
      }
    });
  }
}
