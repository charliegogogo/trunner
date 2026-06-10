import { cpus } from 'node:os';
import type { ToolId } from '../types/tool.js';
import type {
  ProgressInfo,
  PromptRequest,
  PromptAnswer,
} from '../types/events.js';
import type { WorkingDir } from './discover.js';
import { createRunner, type RunnerHandle } from '../runner/executor.js';
import { getDefaultRegistry } from '../registry/tool-registry.js';

export type WorkingDirEvent =
  | { kind: 'started'; workingDir: WorkingDir }
  | { kind: 'resolving'; workingDir: WorkingDir; toolId: ToolId; version: string | null }
  | { kind: 'stdout'; workingDir: WorkingDir; chunk: string }
  | { kind: 'stderr'; workingDir: WorkingDir; chunk: string }
  | { kind: 'progress'; workingDir: WorkingDir; info: ProgressInfo }
  | { kind: 'prompt'; workingDir: WorkingDir; req: PromptRequest; answer: PromptAnswer }
  | { kind: 'exited'; workingDir: WorkingDir; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'done'; summary: RunSummary };

export interface RunSummary {
  total: number;
  succeeded: number;
  failed: number;
  /** dir → exit code (0, non-zero, or null when killed by a signal). */
  workingDirs: Map<string, number | null>;
}

export interface RunWorkingDirsOptions {
  /** Max working directories running in parallel. Default: os.cpus().length. */
  readonly concurrency?: number;
  /**
   * Pin the tool binary version (e.g. "1.6.6"). Overrides .trunnerrc's
   * `version` and the project's HCL `required_version`. Phase 2A.5 only
   * honors this when the pinned version is already installed locally —
   * auto-install is Phase 2B.
   */
  readonly toolVersionRef?: string;
  /** Override the working directory's .trunnerrc `tool` field for this invocation. */
  readonly toolOverride?: string;
  /** If true, pass --auto-approve / -auto-approve when supported. */
  readonly autoApprove?: boolean;
}

const DEFAULT_CONCURRENCY = (): number => Math.max(1, cpus().length);

export async function* runWorkingDirs(
  workingDirs: readonly WorkingDir[],
  command: string,
  args: readonly string[],
  opts: RunWorkingDirsOptions = {},
): AsyncIterable<WorkingDirEvent> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY());
  const queue: WorkingDir[] = [...workingDirs];

  const summary: RunSummary = {
    total: workingDirs.length,
    succeeded: 0,
    failed: 0,
    workingDirs: new Map(),
  };

  type Slot = { event: WorkingDirEvent };
  const slots: Slot[] = [];
  let waiter: ((slot: Slot) => void) | null = null;
  const push = (event: WorkingDirEvent): void => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w({ event });
    } else {
      slots.push({ event });
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, Math.max(queue.length, 1));
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker(queue, command, args, opts, push, summary));
  }

  void Promise.all(workers).then(() => {
    push({ kind: 'done', summary });
  });

  while (true) {
    let slot: Slot;
    if (slots.length > 0) {
      slot = slots.shift() as Slot;
    } else {
      slot = await new Promise<Slot>((resolve) => {
        waiter = resolve;
      });
    }
    yield slot.event;
    if (slot.event.kind === 'done') return;
  }
}

async function worker(
  queue: WorkingDir[],
  command: string,
  args: readonly string[],
  opts: RunWorkingDirsOptions,
  push: (e: WorkingDirEvent) => void,
  summary: RunSummary,
): Promise<void> {
  while (queue.length > 0) {
    const wd = queue.shift() as WorkingDir;
    push({ kind: 'started', workingDir: wd });
    const code = await runOneWorkingDir(wd, command, args, opts, push);
    summary.workingDirs.set(wd.dir, code);
    if (code === 0) summary.succeeded++;
    else summary.failed++;
  }
}

async function runOneWorkingDir(
  wd: WorkingDir,
  command: string,
  args: readonly string[],
  opts: RunWorkingDirsOptions,
  push: (e: WorkingDirEvent) => void,
): Promise<number | null> {
  const toolId = (opts.toolOverride ?? wd.config.tool) as ToolId;
  const tool = getDefaultRegistry().get(toolId);

  const installed = await tool.binary.listInstalled();
  const version = pickVersion(installed, opts.toolVersionRef, wd.config.version);
  push({ kind: 'resolving', workingDir: wd, toolId, version });

  if (!version) {
    const msg = `error: no installed ${toolId} binary found. Run: trunner tools install ${toolId} [version]\n`;
    push({ kind: 'stderr', workingDir: wd, chunk: msg });
    push({ kind: 'exited', workingDir: wd, code: 1, signal: null });
    return 1;
  }

  const spec = tool.commands.get(command);
  if (!spec) {
    const available = tool.commands.list().map((c) => c.name).join(', ');
    const msg = `error: unknown command '${command}' for ${toolId}. Available: ${available}\n`;
    push({ kind: 'stderr', workingDir: wd, chunk: msg });
    push({ kind: 'exited', workingDir: wd, code: 1, signal: null });
    return 1;
  }

  const toolArgs = tool.commands.buildInvocation(command, {
    cwd: wd.dir,
    extraArgs: [...args],
    autoApprove: opts.autoApprove,
  });

  const binaryPath = tool.binary.binaryPath(version);

  const runner: RunnerHandle = createRunner({});
  runner.on('stdout', (chunk) => push({ kind: 'stdout', workingDir: wd, chunk }));
  runner.on('stderr', (chunk) => push({ kind: 'stderr', workingDir: wd, chunk }));
  runner.on('progress', (info) => push({ kind: 'progress', workingDir: wd, info }));
  runner.on('prompt', (req, answer) => push({ kind: 'prompt', workingDir: wd, req, answer }));

  let code: number | null = 0;
  let signal: NodeJS.Signals | null = null;
  runner.on('exit', (c, s) => {
    code = c;
    signal = s;
    push({ kind: 'exited', workingDir: wd, code: c, signal: s });
  });

  try {
    await runner.run({ binaryPath, args: toolArgs, cwd: wd.dir });
  } catch (err) {
    push({ kind: 'stderr', workingDir: wd, chunk: `error: spawn failed: ${(err as Error).message}\n` });
    push({ kind: 'exited', workingDir: wd, code: 1, signal: null });
    return 1;
  }

  if (code !== 0) return code;
  return signal ? null : 0;
}

function pickVersion(
  installed: readonly string[],
  cliRef: string | undefined,
  rcRef: string | undefined,
): string | null {
  if (installed.length === 0) return null;
  if (cliRef && installed.includes(cliRef)) return cliRef;
  if (rcRef && installed.includes(rcRef)) return rcRef;
  return installed[0] ?? null;
}
