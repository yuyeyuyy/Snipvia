import type { CommandRiskSummary, PermissionRisk } from '../../../shared/agent/permission';
import { workspaceRelativePath } from '../policies/pathPolicy';

type Token = { type: 'word' | 'operator'; value: string };
export interface ParsedCommand { argv: string[]; redirects: Array<{ operator: string; path: string }> }
export interface CommandStructure { commands: ParsedCommand[]; operators: string[] }
export interface CommandRiskRule {
  id: string;
  /** Extensions can raise risk or block syntax, never lower the built-in verdict. */
  analyze(structure: Readonly<CommandStructure>): { risk: PermissionRisk; reason: string; blocked?: boolean } | undefined;
}
const rank: Record<PermissionRisk, number> = { SAFE: 0, REVIEW: 1, DANGEROUS: 2 };
const maxRisk = (a: PermissionRisk, b: PermissionRisk): PermissionRisk => rank[a] >= rank[b] ? a : b;

/** A deliberately small literal shell grammar. No shell expansion or execution is performed. */
function tokenize(source: string): Token[] {
  if (!source.trim() || source.length > 8192 || [...source].some((char) =>
    (char.charCodeAt(0) < 32 && char !== '\t') || char.charCodeAt(0) === 127)) throw new Error('命令为空、过长或包含控制字符');
  const tokens: Token[] = [];
  let word = '', started = false;
  let quote: "'" | '"' | undefined;
  const flush = () => { if (started) tokens.push({ type: 'word', value: word }); word = ''; started = false; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote === "'") {
      if (char === "'") quote = undefined; else word += char;
      continue;
    }
    if (char === '$' || char === '`') throw new Error('变量展开或命令替换不受支持');
    if (char === '\\') {
      if (++index >= source.length) throw new Error('转义不完整');
      const next = source[index];
      if (quote === '"' && !['"', '\\', '$', '`'].includes(next)) word += '\\';
      word += next; started = true; continue;
    }
    if (quote === '"') { if (char === '"') quote = undefined; else word += char; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (char === ' ' || char === '\t') { flush(); continue; }
    if ('(){}*?[]~!#%'.includes(char)) throw new Error('子 shell、glob、历史或平台变量语法不受支持');
    if ('|&;<>'.includes(char)) {
      flush();
      let operator = char;
      if (source[index + 1] === char && '|&<>'.includes(char)) operator += source[++index];
      if (operator === '&' || operator === '<<') throw new Error('后台执行与 here-document 不受支持');
      tokens.push({ type: 'operator', value: operator });
    } else { word += char; started = true; }
    if (tokens.length > 256) throw new Error('命令结构超过上限');
  }
  if (quote) throw new Error('引号未闭合');
  flush();
  if (tokens.length > 256) throw new Error('命令结构超过上限');
  return tokens;
}

/** Literal parse only; throws for expansion, globbing, heredoc and other dynamic syntax. */
export function parseCommandStructure(source: string): CommandStructure {
  const tokens = tokenize(source);
  const result: CommandStructure = { commands: [], operators: [] };
  let command: ParsedCommand = { argv: [], redirects: [] };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'word') { command.argv.push(token.value); continue; }
    if (['>', '>>', '<'].includes(token.value)) {
      const target = tokens[++index];
      if (!target || target.type !== 'word') throw new Error('重定向缺少路径');
      command.redirects.push({ operator: token.value, path: target.value });
    } else {
      if (!command.argv.length) throw new Error('空命令');
      result.commands.push(command); result.operators.push(token.value);
      command = { argv: [], redirects: [] };
    }
  }
  if (!command.argv.length || result.commands.length >= 32) throw new Error('命令不完整或过多');
  result.commands.push(command);
  if (result.commands.some(({ argv }) => !argv[0] || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))) throw new Error('环境赋值不受支持');
  return result;
}

function simpleRisk(argv: string[]): { risk: PermissionRisk; reason: string } {
  const [executable, ...args] = argv;
  if (executable === 'pwd' && args.every((arg) => ['-L', '-P'].includes(arg))) return { risk: 'SAFE', reason: '读取当前目录' };
  if (executable === 'ls') {
    let flags = true;
    const safe = args.every((arg) => {
      if (arg === '--') { flags = false; return true; }
      if (flags && arg.startsWith('-')) return /^-[aAlh1dF]+$/.test(arg);
      try { workspaceRelativePath(arg); return true; } catch { return false; }
    });
    if (safe) return { risk: 'SAFE', reason: '列出工作区中的目录项' };
  }
  if (executable === 'git' && args[0] === 'status' && args.slice(1).every((arg) =>
    ['--short', '--branch', '--porcelain', '--porcelain=v1', '--porcelain=v2', '-s', '-b', '-sb', '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all'].includes(arg))) {
    return { risk: 'SAFE', reason: '读取 Git 状态（执行层仍需禁用外部 helper / fsmonitor）' };
  }
  if ((executable === 'pnpm' && args[0] === 'install') || (executable === 'git' && args[0] === 'commit')) {
    return { risk: 'REVIEW', reason: '会修改项目，可能执行依赖脚本或 Git hooks' };
  }
  if (['rm', 'rmdir', 'del', 'erase', 'sudo', 'su', 'chmod', 'chown', 'kill', 'killall', 'taskkill'].includes(executable.toLowerCase())) {
    return { risk: 'DANGEROUS', reason: '删除、提权、权限或进程操作' };
  }
  return { risk: 'DANGEROUS', reason: '未在只读命令白名单中；脚本、解释器及未知参数均需审核' };
}

export class CommandRiskAnalyzer {
  constructor(private readonly rules: readonly CommandRiskRule[] = []) {}
  analyze(source: string): CommandRiskSummary {
    try {
      const structure = parseCommandStructure(source);
      let risk: PermissionRisk = 'SAFE';
      let blocked = false;
      const reasons: string[] = [];
      for (const command of structure.commands) {
        const verdict = simpleRisk(command.argv);
        risk = maxRisk(risk, verdict.risk); reasons.push(verdict.reason);
        for (const redirect of command.redirects) {
          try { workspaceRelativePath(redirect.path); } catch { blocked = true; }
          risk = maxRisk(risk, 'REVIEW');
        }
      }
      // Even benign pipelines are not executable by the initial argv-only command contract.
      if (structure.operators.length || structure.commands.some((command) => command.redirects.length)) {
        blocked = true; risk = maxRisk(risk, 'REVIEW'); reasons.push('管道、命令链和重定向仅用于分析，不允许作为执行计划');
      }
      const downloaded = structure.commands.some(({ argv }) => ['curl', 'wget', 'Invoke-WebRequest', 'iwr'].includes(argv[0]));
      const interpreted = structure.commands.some(({ argv }) => ['sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'node'].includes(argv[0]));
      if (downloaded && interpreted) { risk = 'DANGEROUS'; reasons.push('检测到下载内容并交给解释器执行'); }
      for (const rule of this.rules) {
        const verdict = rule.analyze(structuredClone(structure));
        if (verdict) { risk = maxRisk(risk, verdict.risk); blocked ||= Boolean(verdict.blocked); reasons.push(verdict.reason); }
      }
      return { risk, reasons: [...new Set(reasons)], blocked,
        ...(!blocked ? { argv: [...structure.commands[0].argv] } : {}) };
    } catch (error) {
      return { risk: 'DANGEROUS', blocked: true, reasons: [error instanceof Error ? error.message : '无法可靠解析命令'] };
    }
  }
}
