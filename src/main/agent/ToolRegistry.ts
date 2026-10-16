import type { EditingIntent } from '../../shared/agent/editing';
import { z } from 'zod';
import { ToolError } from './ToolError';
import type { NoteChangeIntent } from '../../shared/agent/note-writing';
import type { NotebookToolDefinition, CommandToolDefinition, EditingToolDefinition } from './types/tool';
import type { CommandIntent } from './commands/CommandRunner';
import type { FileChangeIntent, FileMutationToolDefinition, ToolContext, ToolDefinition, ToolDescriptor, ToolResult, WebToolDefinition, WebToolContext, ExternalToolDefinition, ExternalToolIdentity, ToolPermission } from './types/tool';

/** Zod is the single source for advertised JSON Schema and runtime validation. */
export function defineTool<TInput, TOutput>(definition: {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  permission: ToolDefinition['permission'];
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}): ToolDefinition<TInput, TOutput> {
  return Object.freeze({
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    permission: definition.permission,
    parseInput(input: unknown) {
      const parsed = definition.schema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', '工具参数不符合 inputSchema');
      return parsed.data;
    },
    execute: definition.execute
  });
}

export function defineWebTool<TInput, TOutput>(definition: {
  name: string; description: string; schema: z.ZodType<TInput>;
  execute(input: TInput, context: WebToolContext): Promise<ToolResult<TOutput>>;
}): WebToolDefinition<TInput, TOutput> {
  return Object.freeze({
    name: definition.name, description: definition.description, permission: 'network:read' as const,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    parseInput(input: unknown) {
      const parsed = definition.schema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', '工具参数不符合 inputSchema');
      return parsed.data;
    },
    execute: definition.execute
  });
}

export function defineFileMutationTool<TInput>(definition: {
  name: string; description: string; schema: z.ZodType<TInput>;
  prepare(input: TInput): FileChangeIntent;
}): FileMutationToolDefinition<TInput> {
  return Object.freeze({
    name: definition.name, description: definition.description, permission: 'workspace:write' as const,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    parseInput(input: unknown) {
      const parsed = definition.schema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', '工具参数不符合 inputSchema');
      return parsed.data;
    },
    prepare: definition.prepare
  });
}

export function defineNotebookTool<TInput>(definition: {
  name: string; description: string; schema: z.ZodType<TInput>; prepare(input: TInput): NoteChangeIntent;
}): NotebookToolDefinition<TInput> {
  return Object.freeze({ name: definition.name, description: definition.description, permission: 'notebook:write' as const,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    parseInput(input: unknown) { const parsed = definition.schema.safeParse(input); if (!parsed.success) throw new ToolError('INVALID_INPUT', '笔记写入参数无效'); return parsed.data; },
    prepare: definition.prepare });
}

export function defineCommandTool<TInput>(definition: { name: string; description: string; schema: z.ZodType<TInput>; prepare(input: TInput): CommandIntent }): CommandToolDefinition<TInput> {
  return Object.freeze({ name: definition.name, description: definition.description, permission: 'workspace:execute' as const,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    parseInput(input: unknown) { const parsed = definition.schema.safeParse(input); if (!parsed.success) throw new ToolError('INVALID_INPUT', '命令工具参数无效'); return parsed.data; },
    prepare: definition.prepare });
}

export function defineEditingTool<TInput>(definition: { name: string; description: string; schema: z.ZodType<TInput>; prepare(input: TInput): EditingIntent }): EditingToolDefinition<TInput> {
  return Object.freeze({ name: definition.name, description: definition.description, permission: 'conversation:propose' as const,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    parseInput(input: unknown) { const parsed = definition.schema.safeParse(input); if (!parsed.success) throw new ToolError('INVALID_INPUT', '编辑提案参数无效'); return parsed.data; }, prepare: definition.prepare });
}

type RegisteredTool = ToolDescriptor & ({
  permission: 'workspace:read';
  invoke(input: unknown, context: ToolContext): Promise<ToolResult>;
} | { permission: 'network:read'; invoke(input: unknown, context: WebToolContext): Promise<ToolResult> }
  | { permission: 'external:execute'; external: ExternalToolIdentity; parseInput(input: unknown): unknown; invoke(input: unknown, context: Pick<ToolContext, 'toolCallId' | 'signal'>): Promise<ToolResult> }
  | { permission: 'workspace:write'; prepare(input: unknown): FileChangeIntent }
  | { permission: 'notebook:write'; prepare(input: unknown): NoteChangeIntent }
  | { permission: 'workspace:execute'; prepare(input: unknown): CommandIntent }
  | { permission: 'conversation:propose'; prepare(input: unknown): EditingIntent });

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly allowedPermissions?: ReadonlySet<ToolPermission>;

  constructor(allowedPermissions?: readonly ToolPermission[]) {
    this.allowedPermissions = allowedPermissions ? new Set(allowedPermissions) : undefined;
  }

  assertPermissionEnabled(permission: ToolPermission): void {
    if (this.allowedPermissions && !this.allowedPermissions.has(permission)) {
      throw new ToolError('PERMISSION_DENIED', '当前 Agent 未开放此工具权限，不能通过模型或已有审批启用');
    }
  }

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput> | FileMutationToolDefinition<TInput> | NotebookToolDefinition<TInput> | CommandToolDefinition<TInput> | EditingToolDefinition<TInput> | WebToolDefinition<TInput, TOutput> | ExternalToolDefinition<TInput, TOutput>): () => void {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || !tool.description.trim()) {
      throw new ToolError('INVALID_INPUT', '工具名称或描述无效');
    }
    if (this.tools.has(tool.name)) throw new ToolError('DUPLICATE_TOOL', '工具名称已注册');
    if (tool.permission !== 'workspace:read' && tool.permission !== 'network:read' && tool.permission !== 'external:execute' && !(['workspace:write', 'notebook:write', 'workspace:execute', 'conversation:propose'].includes(tool.permission) && 'prepare' in tool)) {
      throw new ToolError('PERMISSION_DENIED', '写入工具必须使用提案接口，不能直接执行');
    }
    const parseInput = tool.parseInput.bind(tool);
    const descriptor = {
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema)
    };
    if (tool.permission === 'conversation:propose') {
      const prepare = tool.prepare.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'conversation:propose', prepare: (input: unknown) => prepare(parseInput(input)) }));
    } else if (tool.permission === 'notebook:write') {
      const prepare = tool.prepare.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'notebook:write', prepare: (input: unknown) => prepare(parseInput(input)) }));
    } else if (tool.permission === 'workspace:execute') {
      const prepare = tool.prepare.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'workspace:execute', prepare: (input: unknown) => prepare(parseInput(input)) }));
    } else if ('prepare' in tool) {
      const prepare = tool.prepare.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'workspace:write',
        prepare: (input: unknown) => prepare(parseInput(input)) }));
    } else if (tool.permission === 'external:execute') {
      const execute = tool.execute.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'external:execute',
        external: Object.freeze(structuredClone(tool.external)), parseInput,
        invoke: async (input: unknown, context: Pick<ToolContext, 'toolCallId' | 'signal'>) => execute(parseInput(input), context) }));
    } else if (tool.permission === 'network:read') {
      const execute = tool.execute.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'network:read',
        invoke: async (input: unknown, context: WebToolContext) => execute(parseInput(input), context) }));
    } else {
      const execute = tool.execute.bind(tool);
      this.tools.set(tool.name, Object.freeze({ ...descriptor, permission: 'workspace:read',
        invoke: async (input: unknown, context: ToolContext) => execute(parseInput(input), context) }));
    }
    const registered = this.tools.get(tool.name);
    return () => { if (this.tools.get(tool.name) === registered) this.tools.delete(tool.name); };
  }

  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()].filter((tool) => !this.allowedPermissions || this.allowedPermissions.has(tool.permission)).map(({ name, description, inputSchema, permission }) => ({
      name, description, inputSchema: structuredClone(inputSchema), permission
    }));
  }

  /** Internal execution boundary. Callers use ToolExecutor, never invoke tools directly. */
  resolve(name: string): RegisteredTool {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolError('TOOL_NOT_FOUND', '工具未注册');
    this.assertPermissionEnabled(tool.permission);
    return tool;
  }
}
