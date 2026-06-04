import { cpus } from 'node:os';
import type { ToolId } from '../types/tool.js';
import type {
  ProgressInfo,
  PromptRequest,
  PromptAnswer,
} from '../types/events.js';
import type { Workspace } from './discover.js';
import { createRunner, type RunnerHandle } from '../runner/executor.js';
import { getDefaultRegistry } from '../registry/tool-registry.js';

export type WorkspaceEvent =
  | { kind: 'started'; workspace: Workspace }
  | { kind: 'resolving'; workspace: Workspace; toolId: ToolId; version: string | null }
  | { kind: 'stdout'; workspace: Workspace; chunk: string }
  | { kind: 'stderr'; workspace: Workspace; chunk: string }
  | { kind: 'progress'; workspace: Workspace; info: ProgressInfo }
  | { kind: 'prompt'; workspace: Workspace; req: PromptRequest; answer: PromptAnswer }
  | { kind: 'exited'; workspace: Workspace; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'done'; summary: RunSummary };

export interface RunSummary {
  total: number;
  succeeded: number;
  failed: number;
  /** dir → exit code (0, non-zero, or null when killed by a signal). */
  workspaces: Map<string, number | null>;
}

export interface RunWorkspacesOptions {
  /** Max workspaces running in parallel. Default: os.cpus().length. */
  readonly concurrency?: number;
  /**
   * Pin the tool binary version (e.g. "1.6.6"). Overrides .trunnerrc's
   * `version` and the project's HCL `required_version`. Phase 2A.5 only
   * honors this when the pinned version is already installed locally —
   * auto-install is Phase 2B.
   */
  readonly toolVersionRef?: string;
  /** Override the workspace's .trunnerrc `tool` field for this invocation. */
  readonly toolOverride?: string;
  /** If true, pass --auto-approve / -auto-approve when supported. */
  readonly autoApprove?: boolean;
}

const DEFAULT_CONCURRENCY = (): number => Math.max(1, cpus().length);

export async function* runWorkspaces(
  workspaces: readonly Workspace[],
  command: string,
  args: readonly string[],
  opts: RunWorkspacesOptions = {},
): AsyncIterable<WorkspaceEvent> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY());
  const queue: Workspace[] = [...workspaces];

  const summary: RunSummary = {
    total: workspaces.length,
    succeeded: 0,
    failed: 0,
    workspaces: new Map(),
  };

  type Slot = { event: WorkspaceEvent };
  const slots: Slot[] = [];
  let waiter: ((slot: Slot) => void) | null = null;
  const push = (event: WorkspaceEvent): void => {
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
  queue: Workspace[],
  command: string,
  args: readonly string[],
  opts: RunWorkspacesOptions,
  push: (e: WorkspaceEvent) => void,
  summary: RunSummary,
): Promise<void> {
  while (queue.length > 0) {
    const ws = queue.shift() as Workspace;
    push({ kind: 'started', workspace: ws });
    const code = await runOneWorkspace(ws, command, args, opts, push);
    summary.workspaces.set(ws.dir, code);
    if (code === 0) summary.succeeded++;
    else summary.failed++;
  }
}

async function runOneWorkspace(
  ws: Workspace,
  command: string,
  args: readonly string[],
  opts: RunWorkspacesOptions,
  push: (e: WorkspaceEvent) => void,
): Promise<number | null> {
  const toolId = (opts.toolOverride ?? ws.config.tool) as ToolId;
  const tool = getDefaultRegistry().get(toolId);

  const installed = await tool.binary.listInstalled();
  const version = pickVersion(installed, opts.toolVersionRef, ws.config.version);
  push({ kind: 'resolving', workspace: ws, toolId, version });

  if (!version) {
    const msg = `error: no installed ${toolId} binary found. Run: trunner tools install ${toolId} [version]\n`;
    push({ kind: 'stderr', workspace: ws, chunk: msg });
    push({ kind: 'exited', workspace: ws, code: 1, signal: null });
    return 1;
  }

  const spec = tool.commands.get(command);
  if (!spec) {
    const available = tool.commands.list().map((c) => c.name).join(', ');
    const msg = `error: unknown command '${command}' for ${toolId}. Available: ${available}\n`;
    push({ kind: 'stderr', workspace: ws, chunk: msg });
    push({ kind: 'exited', workspace: ws, code: 1, signal: null });
    return 1;
  }

  const toolArgs = tool.commands.buildInvocation(command, {
    cwd: ws.dir,
    extraArgs: [...args],
    autoApprove: opts.autoApprove,
  });

  const binaryPath = tool.binary.binaryPath(version);

  const runner: RunnerHandle = createRunner({});
  runner.on('stdout', (chunk) => push({ kind: 'stdout', workspace: ws, chunk }));
  runner.on('stderr', (chunk) => push({ kind: 'stderr', workspace: ws, chunk }));
  runner.on('progress', (info) => push({ kind: 'progress', workspace: ws, info }));
  runner.on('prompt', (req, answer) => push({ kind: 'prompt', workspace: ws, req, answer }));

  let code: number | null = 0;
  let signal: NodeJS.Signals | null = null;
  runner.on('exit', (c, s) => {
    code = c;
    signal = s;
    push({ kind: 'exited', workspace: ws, code: c, signal: s });
  });

  try {
    await runner.run({ binaryPath, args: toolArgs, cwd: ws.dir });
  } catch (err) {
    push({ kind: 'stderr', workspace: ws, chunk: `error: spawn failed: ${(err as Error).message}\n` });
    push({ kind: 'exited', workspace: ws, code: 1, signal: null });
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
