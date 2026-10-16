import type { PermissionRisk } from '../../../shared/agent/permission';
import { workspaceRelativePath } from '../policies/pathPolicy';
import { parseCommandStructure, type ParsedCommand } from './CommandRiskAnalyzer';

/**
 * Approval policy for the selected notebook's sandboxed run_command / run_script.
 * The OS sandbox remains the enforcement boundary; this only decides which literal,
 * statically understood commands may skip the user's confirmation. Anything else asks.
 */
export interface NotebookCommandAssessment { risk: Extract<PermissionRisk, 'SAFE' | 'DANGEROUS'>; reasons: string[] }

const readOnly = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'find', 'tree', 'stat', 'file', 'du',
  'diff', 'cmp', 'basename', 'dirname', 'echo', 'printf', 'shasum', 'md5', 'true']);
const findWrites = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);
/** Executables that change environment, shell state, services or OS settings. */
const systemExecutables = new Set(['export', 'unset', 'set', 'env', 'source', '.', 'alias', 'ulimit', 'umask', 'setx', 'launchctl', 'defaults',
  'scutil', 'networksetup', 'systemsetup', 'pmset', 'csrutil', 'nvram', 'crontab', 'sudo', 'su', 'doas', 'chsh', 'dscl', 'security',
  'osascript', 'tccutil', 'spctl', 'systemctl', 'sysctl', 'reg', 'chmod', 'chown', 'chflags', 'xattr', 'kill', 'killall', 'pkill']);
const systemText = /(^|[\s;&|(])(export|unset|setx|launchctl|defaults\s+write|sudo|crontab|osascript|networksetup|systemsetup|scutil|nvram|csrutil)\b|(^|[\s;&|(])[A-Za-z_][A-Za-z0-9_]*=|\.(zshrc|zshenv|zprofile|bashrc|bash_profile|profile)\b|\/etc\/|\/Library\/|LaunchAgents|LaunchDaemons/;
const scriptSystemText = /process\.env\s*(\.\w+|\[[^\]]+\])\s*=(?!=)|os\.(environ\s*\[[^\]]+\]\s*=(?!=)|putenv|system|exec\w*)|child_process|subprocess|\bspawn\s*\(|\bexecSync\b|\bsetx\b|launchctl|defaults\s+write|\bexport\s+[A-Za-z_]/;

function inside(value: string): boolean {
  try { workspaceRelativePath(value); return true; } catch { return false; }
}
function hidden(value: string): boolean { return value.split('/').some((part) => part.startsWith('.') && part !== '.'); }
function positional(argv: string[]): string[] {
  const values: string[] = []; let flags = true;
  for (const arg of argv.slice(1)) {
    if (flags && arg === '--') { flags = false; continue; }
    if (flags && arg.startsWith('-') && arg !== '-') continue;
    values.push(arg);
  }
  return values;
}
function flags(argv: string[]): string[] {
  const end = argv.indexOf('--');
  return argv.slice(1, end < 0 ? undefined : end).filter((arg) => arg.startsWith('-') && arg !== '-');
}

function classify({ argv, redirects }: ParsedCommand): { safe: true; organize: boolean } | { safe: false; reason: string } {
  const [executable] = argv;
  if (redirects.length) return { safe: false, reason: '包含重定向写入，需确认目标文件' };
  if (systemExecutables.has(executable)) return { safe: false, reason: `「${executable}」可能修改环境变量、权限、进程或系统设置` };
  const args = positional(argv);
  if (readOnly.has(executable)) {
    if (executable === 'find' && argv.some((arg) => findWrites.has(arg))) return { safe: false, reason: 'find 带有执行或删除动作' };
    // grep/find patterns are checked like paths too: absolute or parent references ask first.
    if (!['echo', 'printf'].includes(executable) && !args.every(inside)) return { safe: false, reason: '参数引用了笔记本外的路径' };
    return { safe: true, organize: false };
  }
  if (['mkdir', 'touch', 'mv', 'cp'].includes(executable)) {
    const options = flags(argv);
    const allowed: string[] = ({ mkdir: ['-p', '-v'], touch: [], mv: ['-n', '-v'], cp: ['-n', '-v', '-R', '-r', '-p'] } as Record<string, string[]>)[executable];
    if (!options.every((option) => allowed.includes(option))) return { safe: false, reason: `${executable} 使用了未审核的参数` };
    if (['mv', 'cp'].includes(executable) && !options.includes('-n')) return { safe: false, reason: `${executable} 未使用 -n，可能覆盖已有文件` };
    if (!args.length || !args.every(inside)) return { safe: false, reason: '目标路径不在笔记本内' };
    if (args.some(hidden)) return { safe: false, reason: '涉及隐藏文件或目录' };
    return { safe: true, organize: true };
  }
  return { safe: false, reason: `「${executable}」不在免确认的只读或整理命令列表中` };
}

export function assessNotebookCommand(command: string): NotebookCommandAssessment {
  const system = systemText.test(command);
  let structure;
  try { structure = parseCommandStructure(command); }
  catch (error) {
    return { risk: 'DANGEROUS', reasons: [
      `命令包含变量展开、命令替换、通配符或其他无法静态确认的语法（${error instanceof Error ? error.message : '无法解析'}）`,
      ...(system ? ['可能修改环境变量或系统设置'] : [])] };
  }
  if (structure.operators.some((operator) => !['&&', '||', ';', '|'].includes(operator))) {
    return { risk: 'DANGEROUS', reasons: ['包含未审核的命令连接方式'] };
  }
  const verdicts = structure.commands.map(classify);
  const refused = verdicts.flatMap((verdict) => verdict.safe ? [] : [verdict.reason]);
  if (refused.length || system) {
    return { risk: 'DANGEROUS', reasons: [...new Set([...refused, ...(system ? ['可能修改环境变量或系统设置'] : [])])] };
  }
  const organizes = verdicts.some((verdict) => verdict.safe && verdict.organize);
  return { risk: 'SAFE', reasons: [organizes ? '仅在当前笔记本内创建目录或不覆盖地移动、复制文件' : '只读命令，仅查看当前笔记本'] };
}

export function assessNotebookScript(language: string, code: string): NotebookCommandAssessment {
  const label = ({ javascript: 'JavaScript', python: 'Python', shell: 'Shell' } as Record<string, string>)[language] ?? language;
  return { risk: 'DANGEROUS', reasons: [
    `将在笔记本沙箱中运行 ${label} 脚本，可以读写当前笔记本并占用计算资源`,
    '脚本行为无法静态确认，每次运行都需要你确认',
    ...(scriptSystemText.test(code) || (language === 'shell' && systemText.test(code)) ? ['脚本会启动子进程或尝试修改环境变量、系统设置'] : [])] };
}
