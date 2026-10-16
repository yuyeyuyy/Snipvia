import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { ToolError, throwIfAborted } from '../ToolError';
import { utf8Prefix } from '../web/operation';

export interface SandboxRequest { command: string; cwd: string; root: string; scratch: string; readOnly: boolean; protectedPaths: string[]; signal: AbortSignal; id: string }
export interface SandboxPlan { argv: string[]; env: NodeJS.ProcessEnv; cleanup(): Promise<void> }
export interface CommandSandbox { prepare(request: SandboxRequest): Promise<SandboxPlan> }
export interface ProcessOutput { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; truncated: boolean; cancelled: boolean; timedOut: boolean; outputLimit: boolean }

let sandboxInUse = false;
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function cleanCommandEnvironment(scratch: string): NodeJS.ProcessEnv {
  return { PATH: `/opt/homebrew/bin:/usr/local/bin:${process.platform === 'darwin' ? '/Library/Developer/CommandLineTools/usr/bin:' : ''}/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', PYTHONDONTWRITEBYTECODE: '1',
    XDG_CONFIG_HOME: scratch, XDG_CACHE_HOME: scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OPENSSL_CONF: '/dev/null',
    ELECTRON_RUN_AS_NODE: '1' };
}
function runtimeDirectory(executable: string) {
  const marker = executable.indexOf('.app/Contents/');
  return marker >= 0 ? executable.slice(0, marker + '.app/Contents'.length) : path.dirname(executable);
}

/** Maintained OS sandbox backend. Never fall back to an unrestricted spawn. */
export class NativeCommandSandbox implements CommandSandbox {
  async prepare(request: SandboxRequest): Promise<SandboxPlan> {
    if (!['darwin', 'linux'].includes(process.platform)) throw new ToolError('SANDBOX_UNAVAILABLE', '当前平台的命令沙箱尚未接入，未执行命令');
    if (sandboxInUse) throw new ToolError('CALL_IN_PROGRESS', '已有命令正在使用系统沙箱');
    sandboxInUse = true;
    let ownsSandbox = true;
    const cleanup = async () => { if (!ownsSandbox) return; ownsSandbox = false; try { await SandboxManager.reset(); } finally { sandboxInUse = false; } };
    try {
      throwIfAborted(request.signal);
      const dependencies = await SandboxManager.checkDependenciesAsync();
      if (dependencies.errors.length) throw new ToolError('SANDBOX_UNAVAILABLE', '系统沙箱依赖不可用，未执行命令');
      const executable = await realpath(process.execPath);
      const runtime = runtimeDirectory(executable);
      if ([request.root, request.scratch, runtime, ...request.protectedPaths].some(value => /[*?[\]{}]/.test(value))) throw new ToolError('SANDBOX_UNAVAILABLE', '当前目录包含沙箱路径模式字符，请使用其他笔记本目录');
      const hidden = ['.env', '.env.*', '.ssh', '.aws', '.codex', '.agents', '.git', '.npmrc', '.netrc', '.gnupg', '.config', '*.pem', '*.key'];
      const sensitive = hidden.map(name => `${request.root}/**/${name}`);
      const config: SandboxRuntimeConfig = {
        network: { allowedDomains: [], deniedDomains: ['*'], allowUnixSockets: [], allowAllUnixSockets: false, allowLocalBinding: false },
        filesystem: { denyRead: ['/', ...request.protectedPaths, ...sensitive, '/usr/local/etc', '/usr/local/var', '/opt/homebrew/etc', '/opt/homebrew/var'],
          allowRead: [request.root, request.scratch, runtime, '/bin', '/sbin', '/usr', '/System', '/Library/Apple', '/Library/Frameworks', '/Library/Developer',
            '/opt/homebrew/bin', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/opt/homebrew/lib', '/opt/homebrew/share',
            '/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/fd', '/private/etc/localtime', '/private/var/db/timezone'],
          allowWrite: [request.scratch, ...(request.readOnly ? [] : [request.root])],
          denyWrite: [...request.protectedPaths, ...sensitive, '/tmp/claude', '/private/tmp/claude'], allowGitConfig: false },
        enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false, allowAppleEvents: false
      };
      await SandboxManager.initialize(config, undefined, false);
      throwIfAborted(request.signal);
      const wrapped = await SandboxManager.wrapWithSandboxArgv(request.command, '/bin/bash', config, request.signal, request.cwd, { commandId: request.id });
      if (!SandboxManager.isSandboxingEnabled() || wrapped.argv[0] !== '/bin/bash' || wrapped.argv[1] !== '-c' || wrapped.argv[2] === request.command) throw new ToolError('SANDBOX_UNAVAILABLE', '未取得系统隔离执行计划，未执行命令');
      // The SDK embeds its proxy routing in the wrapped command. Its returned
      // environment also contains the parent's secrets, so never inherit it.
      return { argv: wrapped.argv, env: cleanCommandEnvironment(request.scratch), cleanup };
    } catch (error) {
      await cleanup();
      if (error instanceof ToolError) throw error;
      throw new ToolError('SANDBOX_UNAVAILABLE', '系统沙箱初始化失败，未执行命令');
    }
  }
}

/** Drain bounded pipes, wait for actual exit, and tear down the entire process group. */
export async function executeSandboxedProcess(plan: SandboxPlan, cwd: string, stdin: string, signal: AbortSignal, timeoutMs: number): Promise<ProcessOutput> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(plan.argv[0], plan.argv.slice(1), { cwd, env: plan.env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', bytes = 0, truncated = false, outputLimit = false, timedOut = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (hard = false) => {
      if (!child.pid) return;
      try { if (process.platform === 'win32') child.kill(hard ? 'SIGKILL' : 'SIGTERM'); else process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM'); } catch { /* The group may already be gone. */ }
      if (!hard && !killTimer) killTimer = setTimeout(() => kill(true), 250);
    };
    const cancelled = () => kill();
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    signal.addEventListener('abort', cancelled, { once: true });
    const capture = (kind: 'stdout' | 'stderr', chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      const previous = kind === 'stdout' ? stdout : stderr;
      const next = utf8Prefix(previous + chunk, 16 * 1024);
      if (next.length < previous.length + chunk.length) truncated = true;
      if (kind === 'stdout') stdout = next; else stderr = next;
      if (bytes > 1024 * 1024 && !outputLimit) { outputLimit = true; kill(); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => capture('stdout', chunk)); child.stderr.on('data', chunk => capture('stderr', chunk));
    child.stdin.on('error', () => {});
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', cancelled); kill(true); };
    child.once('error', () => { cleanup(); reject(new ToolError('COMMAND_FAILED', '命令进程未能启动')); });
    child.once('close', (exitCode, exitSignal) => {
      const externalTimeout = signal.aborted && signal.reason instanceof ToolError && signal.reason.code === 'TIMEOUT';
      cleanup(); resolve({ exitCode, signal: exitSignal, stdout, stderr, truncated, outputLimit, cancelled: signal.aborted && !externalTimeout, timedOut: timedOut || externalTimeout });
    });
    child.stdin.end(stdin);
    if (signal.aborted) cancelled();
  });
}
