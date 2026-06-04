import { describe, it, expect } from 'vitest';
import { createMockRunner, type MockScriptStep } from '../../src/mock/mock-runner.js';

describe('MockRunner', () => {
  it('emits stdout chunks during the script', async () => {
    const steps: MockScriptStep[] = [
      { delayMs: 10, stdout: 'hello' },
      { delayMs: 10, stdout: 'world' },
      { delayMs: 10, exit: { code: 0 } },
    ];
    const r = createMockRunner({ script: steps });
    const chunks: string[] = [];
    let exitCode: number | null = null;
    r.on('stdout', (c) => chunks.push(c));
    r.on('exit', (c) => { exitCode = c; });
    await r.start();
    expect(chunks.join('')).toBe('helloworld');
    expect(exitCode).toBe(0);
  });

  it('emits progress events with percent info', async () => {
    const steps: MockScriptStep[] = [
      { delayMs: 5, progress: { phase: 'plan', current: 25, total: 100, unit: 'percent' } },
      { delayMs: 5, progress: { phase: 'plan', current: 100, total: 100, unit: 'percent', message: 'done' } },
      { delayMs: 5, exit: { code: 0 } },
    ];
    const r = createMockRunner({ script: steps });
    const progress: Array<{ phase: string; current: number; message?: string }> = [];
    r.on('progress', (p) => progress.push({ phase: p.phase, current: p.current, message: p.message }));
    await r.start();
    expect(progress.length).toBe(2);
    expect(progress[0]?.phase).toBe('plan');
    expect(progress[1]?.message).toBe('done');
  });

  it('emits a prompt for confirm kind with answer', async () => {
    const steps: MockScriptStep[] = [
      { delayMs: 5, prompt: { question: 'ok?', kind: 'confirm', defaultValue: 'no', answer: 'yes' } },
      { delayMs: 5, exit: { code: 0 } },
    ];
    const r = createMockRunner({ script: steps });
    let captured: string | null = null;
    r.on('prompt', (_req, ans) => {
      ans('yes');
      captured = 'yes';
    });
    await r.start();
    expect(captured).toBe('yes');
  });

  it('cancel() stops the script and emits an exit signal', async () => {
    const steps: MockScriptStep[] = [
      { delayMs: 100, stdout: 'never seen' },
      { delayMs: 100, exit: { code: 0 } },
    ];
    const r = createMockRunner({ script: steps });
    let exitCode: number | null = -1;
    let exitSignal: NodeJS.Signals | null = null;
    r.on('exit', (c, s) => { exitCode = c; exitSignal = s; });
    const promise = r.start();
    setTimeout(() => { void r.cancel(); }, 20);
    await promise;
    expect(exitCode).toBeNull();
    expect(exitSignal).toBe('SIGTERM');
  });

  it('plan command skips prompts by default', () => {
    const r = createMockRunner({ command: 'plan' });
    expect(r.script.some((s) => s.prompt)).toBe(false);
  });
});
