import { EventEmitter } from 'node:events';
import type { ProgressInfo, PromptRequest, RunnerEventMap, Runner } from '@trunner/sdk';

export interface MockScriptStep {
  delayMs?: number;
  stdout?: string;
  stderr?: string;
  progress?: ProgressInfo;
  prompt?: { question: string; kind: 'confirm' | 'input' | 'select'; defaultValue?: string; answer?: string };
  exit?: { code: number; signal?: NodeJS.Signals };
}

export interface MockRunnerOptions {
  tool?: string;
  command?: string;
  stepMs?: number;
  script?: MockScriptStep[];
}

type EventName = keyof RunnerEventMap;

const DEFAULT_SCRIPT: MockScriptStep[] = [
  { delayMs: 200, progress: { phase: 'init', current: 0, total: 100, unit: 'percent' } },
  { delayMs: 200, progress: { phase: 'init', current: 50, total: 100, unit: 'percent' } },
  { delayMs: 200, stdout: 'Initializing the backend...\n' },
  { delayMs: 200, progress: { phase: 'init', current: 100, total: 100, unit: 'percent', message: 'initialized' } },
  { delayMs: 200, progress: { phase: 'plan', current: 0, total: 100, unit: 'percent' } },
  { delayMs: 300, stdout: 'Refreshing state of the cloud...\n' },
  { delayMs: 300, progress: { phase: 'plan', current: 100, total: 100, unit: 'percent', message: 'plan complete' } },
  { delayMs: 200, stdout: 'Plan: 3 to add, 0 to change, 0 to destroy.\n' },
  { delayMs: 200, prompt: { question: 'Do you want to perform these actions?', kind: 'confirm', defaultValue: 'no', answer: 'yes' } },
  { delayMs: 300, progress: { phase: 'apply', current: 0, total: 100, unit: 'percent' } },
  { delayMs: 300, stdout: 'Creating resource_foo...\n' },
  { delayMs: 300, progress: { phase: 'apply', current: 33, total: 100, unit: 'percent' } },
  { delayMs: 300, stdout: 'Creating resource_bar...\n' },
  { delayMs: 300, progress: { phase: 'apply', current: 66, total: 100, unit: 'percent' } },
  { delayMs: 300, stdout: 'Creating resource_baz...\n' },
  { delayMs: 300, progress: { phase: 'apply', current: 100, total: 100, unit: 'percent', message: 'apply complete' } },
  { delayMs: 200, stdout: 'Apply complete! Resources: 3 added, 0 changed, 0 destroyed.\n' },
  { delayMs: 200, exit: { code: 0 } },
];

export class MockRunner extends EventEmitter implements Runner {
  readonly tool: string;
  readonly command: string;
  readonly stepMs: number;
  readonly script: MockScriptStep[];
  private _cancelled = false;
  private _timer: NodeJS.Timeout | null = null;
  private _pendingResolve: (() => void) | null = null;

  constructor(opts: MockRunnerOptions = {}) {
    super();
    this.tool = opts.tool ?? 'terraform';
    this.command = opts.command ?? 'plan';
    this.stepMs = opts.stepMs ?? 250;
    this.script = opts.script ?? this.buildDefaultScript();
  }

  private buildDefaultScript(): MockScriptStep[] {
    if (this.command === 'plan') {
      return DEFAULT_SCRIPT.filter((s) => !s.prompt);
    }
    if (this.command === 'destroy') {
      return DEFAULT_SCRIPT.filter((s) => s.prompt).map((s) => ({
        ...s,
        stdout: (s.stdout ?? '').replace(/Creating /g, 'Destroying '),
      }));
    }
    return DEFAULT_SCRIPT;
  }

  override on<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  async cancel(signal?: AbortSignal): Promise<void> {
    this._cancelled = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pendingResolve?.();
    this._pendingResolve = null;
    this.emit('stderr', '\n[cancelled]\n');
    this.emit('exit', null, (signal?.reason as NodeJS.Signals | undefined) ?? 'SIGTERM');
  }

  async start(): Promise<void> {
    for (let i = 0; i < this.script.length; i++) {
      if (this._cancelled) return;
      const step = this.script[i]!;
      const delay = step.delayMs ?? this.stepMs;
      await new Promise<void>((resolve) => {
        this._pendingResolve = resolve;
        this._timer = setTimeout(() => {
          this._timer = null;
          this._pendingResolve = null;
          resolve();
        }, delay);
      });
      if (this._cancelled) return;
      if (step.stdout) this.emit('stdout', step.stdout);
      if (step.stderr) this.emit('stderr', step.stderr);
      if (step.progress) this.emit('progress', step.progress);
      if (step.prompt) {
        const req: PromptRequest = {
          promptId: `mock-${i}-${Date.now()}`,
          question: step.prompt.question,
          kind: step.prompt.kind,
          ...(step.prompt.defaultValue ? { defaultValue: step.prompt.defaultValue } : {}),
        };
        const answer = step.prompt.answer ?? 'no';
        this.emit('prompt', req, () => undefined);
        this.emit('stdout', `> ${answer}\n`);
      }
      if (step.exit) this.emit('exit', step.exit.code, step.exit.signal ?? null);
    }
  }
}

export function createMockRunner(opts: MockRunnerOptions = {}): MockRunner {
  return new MockRunner(opts);
}
