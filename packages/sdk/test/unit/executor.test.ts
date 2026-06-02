import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

type SpawnFn = (cmd: string, args: readonly string[], opts: unknown) => ChildProcess;

// We will override the executor's spawn via vi.mock before importing it.
const spawnMock = vi.fn<SpawnFn>();

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[], opts: unknown) => spawnMock(cmd, args, opts),
  };
});

function makeFakeChild() {
  const child = new EventEmitter() as unknown as ChildProcess;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  stdout.setEncoding('utf-8');
  stderr.setEncoding('utf-8');
  Object.assign(child, { stdout, stderr, pid: 1234 });

  return {
    child,
    pushStdout(chunk: string) {
      stdout.push(chunk);
    },
    pushStderr(chunk: string) {
      stderr.push(chunk);
    },
    closeWith(code: number | null, signal: NodeJS.Signals | null = null) {
      stdout.push(null);
      stderr.push(null);
      (child as unknown as EventEmitter).emit('close', code, signal);
    },
    emitError(err: Error) {
      (child as unknown as EventEmitter).emit('error', err);
    },
  };
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runner/executor', () => {
  it('streams stdout/stderr chunks and resolves with the result', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);

    const { createRunner } = await import('../../src/runner/executor.js');
    const runner = createRunner({ parseOutput: false });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    runner.on('stdout', (c) => stdoutChunks.push(c));
    runner.on('stderr', (c) => stderrChunks.push(c));

    const runPromise = runner.run({
      binaryPath: '/bin/true',
      args: ['--help'],
      cwd: '/tmp',
    });

    fake.pushStdout('hello\n');
    fake.pushStderr('warn\n');
    fake.pushStdout('done\n');
    fake.closeWith(0);

    const result = await runPromise;
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('hello\ndone\n');
    expect(result.stderr).toBe('warn\n');
    expect(stdoutChunks).toEqual(['hello\n', 'done\n']);
    expect(stderrChunks).toEqual(['warn\n']);
  });

  it('surfaces interactive prompts as prompt events', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);

    const { createRunner } = await import('../../src/runner/executor.js');
    const runner = createRunner({ parseOutput: false });
    const prompts: string[] = [];
    runner.on('prompt', (req) => prompts.push(req.question));

    const runPromise = runner.run({
      binaryPath: '/bin/terraform',
      args: ['apply'],
      cwd: '/tmp',
    });

    fake.pushStdout('Do you want to perform these actions?\n');
    fake.pushStdout('  Terraform will perform...\n');
    fake.closeWith(0);

    await runPromise;
    // Data events on the fake child Readable fire after `close`; flush the
    // microtask queue before checking that the prompt listener was invoked.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(prompts).toEqual(['Do you want to perform these actions?']);
  });

  it('emits exit with non-zero code', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);

    const { createRunner } = await import('../../src/runner/executor.js');
    const runner = createRunner({ parseOutput: false });
    let exitPayload: [number | null, NodeJS.Signals | null] | null = null;
    runner.on('exit', (code, signal) => {
      exitPayload = [code, signal];
    });

    const runPromise = runner.run({ binaryPath: '/bin/false', args: [], cwd: '/tmp' });
    fake.pushStdout('partial\n');
    fake.closeWith(1);
    const result = await runPromise;
    expect(result.exitCode).toBe(1);
    expect(exitPayload).toEqual([1, null]);
  });

  it('rejects when spawn errors out (ENOENT etc.)', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    const { createRunner } = await import('../../src/runner/executor.js');
    const runner = createRunner({ parseOutput: false });
    const runPromise = runner.run({ binaryPath: '/bin/missing', args: [], cwd: '/tmp' });
    fake.emitError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    await expect(runPromise).rejects.toThrow(/ENOENT/);
  });

  it('cancels an in-flight run via AbortSignal', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    const { createRunner } = await import('../../src/runner/executor.js');
    const runner = createRunner({ parseOutput: false });
    const ac = new AbortController();
    const runPromise = runner.run({
      binaryPath: '/bin/sleep',
      args: ['10'],
      cwd: '/tmp',
      signal: ac.signal,
    });
    ac.abort('user-cancel');
    fake.closeWith(null, 'SIGTERM');
    const result = await runPromise;
    expect(result.signal).toBe('SIGTERM');
  });
});
