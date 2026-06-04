import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { runWorkspaces, type WorkspaceEvent, type RunSummary } from '../../src/workspace/runner.js';
import { discoverWorkspaces } from '../../src/workspace/discover.js';
import { getPaths, type TrunnerPaths } from '../../src/env/paths.js';
import { getPlatformInfo } from '../../src/utils/os.js';
import { BaseBinaryManager } from '../../src/tools/base/base-binary-manager.js';
import { BaseProviderManager } from '../../src/tools/base/base-provider-manager.js';
import { BaseTool } from '../../src/tools/base/base-tool.js';
import type { ReleaseSource } from '../../src/tools/base/base-binary-manager.js';
import { terraformCommands } from '../../src/tools/terraform/commands.js';
import { getDefaultRegistry } from '../../src/registry/tool-registry.js';

const spawnMock = vi.fn();

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
    pushStdout(c: string) { stdout.push(c); },
    pushStderr(c: string) { stderr.push(c); },
    closeWith(code: number | null, signal: NodeJS.Signals | null = null) {
      stdout.push(null);
      stderr.push(null);
      (child as unknown as EventEmitter).emit('close', code, signal);
    },
  };
}

const RELEASE_SOURCE: ReleaseSource = {
  async listVersions() { return []; },
  async resolve() { throw new Error('not used'); },
};

class FakeBinaryManager extends BaseBinaryManager {
  readonly fakeVersions: string[];
  constructor(paths: TrunnerPaths, versions: string[]) {
    super({ toolId: 'terraform', binaryName: 'terraform', releaseSource: RELEASE_SOURCE, paths });
    this.fakeVersions = versions;
  }
  override async listInstalled(): Promise<string[]> { return this.fakeVersions; }
}

class FakeProviderManager extends BaseProviderManager {
  constructor(paths: TrunnerPaths) {
    super({ toolId: 'terraform', source: { async resolve() { throw new Error('nope'); } }, paths });
  }
}

class FakeTool extends BaseTool {
  constructor(paths: TrunnerPaths, versions: string[]) {
    super({
      id: 'terraform',
      displayName: 'FakeTerraform',
      binary: new FakeBinaryManager(paths, versions),
      provider: new FakeProviderManager(paths),
      commands: terraformCommands,
    });
  }
}

const platform = getPlatformInfo();
let home: string;
let paths: TrunnerPaths;

function useFakeTool(versions: string[]): void {
  // Mutate the default singleton. The runner re-calls getDefaultRegistry()
  // each time, so the latest registration wins.
  const reg = getDefaultRegistry();
  reg.register('terraform', () => new FakeTool(paths, versions));
  reg.reset();
}

async function touchBinary(version: string): Promise<void> {
  const p = join(paths.binaries, 'terraform', `terraform-${version}${platform.binaryExtension}`);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, '#!/bin/sh\nexit 0\n');
  if (!platform.isWindows) await chmod(p, 0o755);
}

async function mkMonorepo(names: string[]): Promise<string> {
  const root = join(tmpdir(), `trunner-runner-mono-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  for (const n of names) {
    const dir = join(root, n);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.trunnerrc'), 'tool = "terraform"\n', 'utf-8');
  }
  return root;
}

interface CollectedRun {
  events: WorkspaceEvent[];
  startedPromise: Promise<void>;
  resolveStarted: () => void;
  consumer: Promise<void>;
}

async function runAndCollect(
  iter: AsyncIterable<WorkspaceEvent>,
  expectedStarts: number,
): Promise<CollectedRun> {
  const events: WorkspaceEvent[] = [];
  let resolveStarted!: () => void;
  const startedPromise = new Promise<void>((r) => { resolveStarted = r; });
  let startedSeen = 0;
  const consumer = (async () => {
    for await (const e of iter) {
      events.push(e);
      if (e.kind === 'started' && ++startedSeen === expectedStarts) {
        resolveStarted();
      }
    }
  })();
  return { events, startedPromise, resolveStarted, consumer };
}

beforeEach(async () => {
  home = join(tmpdir(), `trunner-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  paths = getPaths(home);
  await mkdir(join(paths.binaries, 'terraform'), { recursive: true });
  await touchBinary('1.6.6');
  spawnMock.mockReset();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('workspace/runner', () => {
  it('emits started → stdout/stderr → exited → done for a single workspace', async () => {
    useFakeTool(['1.6.6']);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);

    const monoRoot = await mkMonorepo(['alpha']);
    const ws = await discoverWorkspaces(monoRoot);
    expect(ws).toHaveLength(1);

    const { events, startedPromise, consumer } = await runAndCollect(
      runWorkspaces(ws, 'plan', []),
      1,
    );
    await startedPromise;
    fake.pushStdout('hello\n');
    fake.pushStderr('warn\n');
    fake.closeWith(0);
    await consumer;

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('started');
    expect(kinds.at(-1)).toBe('done');
    expect(kinds).toContain('stdout');
    expect(kinds).toContain('stderr');
    expect(kinds).toContain('exited');

    const done = events.find((e) => e.kind === 'done');
    if (done && done.kind === 'done') {
      const s: RunSummary = done.summary;
      expect(s.total).toBe(1);
      expect(s.succeeded).toBe(1);
      expect(s.failed).toBe(0);
    }
  });

  it('runs multiple workspaces in parallel (concurrency = 3)', async () => {
    useFakeTool(['1.6.6']);

    const fakes = [makeFakeChild(), makeFakeChild(), makeFakeChild()];
    let callIdx = 0;
    spawnMock.mockImplementation(() => fakes[callIdx++]!.child);

    const monoRoot = await mkMonorepo(['a', 'b', 'c']);
    const ws = await discoverWorkspaces(monoRoot);

    const { events, startedPromise, consumer } = await runAndCollect(
      runWorkspaces(ws, 'plan', [], { concurrency: 3 }),
      3,
    );
    await startedPromise;
    fakes[0]!.closeWith(0);
    fakes[1]!.closeWith(0);
    fakes[2]!.closeWith(0);
    await consumer;

    expect(events.filter((e) => e.kind === 'started')).toHaveLength(3);
    expect(events.filter((e) => e.kind === 'exited')).toHaveLength(3);
    const done = events.find((e) => e.kind === 'done');
    expect(done).toBeDefined();
    if (done && done.kind === 'done') {
      expect(done.summary.succeeded).toBe(3);
      expect(done.summary.failed).toBe(0);
    }
  });

  it('serializes with concurrency = 1', async () => {
    useFakeTool(['1.6.6']);

    const fakes = [makeFakeChild(), makeFakeChild()];
    let callIdx = 0;
    spawnMock.mockImplementation(() => fakes[callIdx++]!.child);

    const monoRoot = await mkMonorepo(['one', 'two']);
    const ws = await discoverWorkspaces(monoRoot);

    const iter = runWorkspaces(ws, 'plan', [], { concurrency: 1 });
    const events: WorkspaceEvent[] = [];
    const startOrder: string[] = [];
    const exitOrder: string[] = [];
    let fakeIdx = 0;

    const consumer = (async () => {
      for await (const e of iter) {
        events.push(e);
        if (e.kind === 'started') {
          startOrder.push(basename(e.workspace.dir));
          // Close the next fake after the worker has registered listeners
          // on it (spawn happens AFTER the started push, in runOneWorkspace).
          setTimeout(() => fakes[fakeIdx++]!.closeWith(0), 0);
        } else if (e.kind === 'exited') {
          exitOrder.push(basename(e.workspace.dir));
        }
      }
    })();
    await consumer;

    expect(startOrder).toEqual(['one', 'two']);
    expect(exitOrder).toEqual(['one', 'two']);
  });

  it('a failed workspace does not abort siblings', async () => {
    useFakeTool(['1.6.6']);

    const fakes = [makeFakeChild(), makeFakeChild()];
    let callIdx = 0;
    spawnMock.mockImplementation(() => fakes[callIdx++]!.child);

    const monoRoot = await mkMonorepo(['fail', 'pass']);
    const ws = await discoverWorkspaces(monoRoot);

    const { events, startedPromise, consumer } = await runAndCollect(
      runWorkspaces(ws, 'plan', [], { concurrency: 2 }),
      2,
    );
    await startedPromise;
    fakes[0]!.closeWith(2); // fail
    fakes[1]!.closeWith(0); // pass
    await consumer;

    const done = events.find((e) => e.kind === 'done');
    expect(done).toBeDefined();
    if (done && done.kind === 'done') {
      expect(done.summary.total).toBe(2);
      expect(done.summary.succeeded).toBe(1);
      expect(done.summary.failed).toBe(1);
    }
  });

  it('reports per-workspace exit codes in the final done event', async () => {
    useFakeTool(['1.6.6']);

    const fakes = [makeFakeChild(), makeFakeChild(), makeFakeChild()];
    let callIdx = 0;
    spawnMock.mockImplementation(() => fakes[callIdx++]!.child);

    const monoRoot = await mkMonorepo(['x', 'y', 'z']);
    const ws = await discoverWorkspaces(monoRoot);

    const { events, startedPromise, consumer } = await runAndCollect(
      runWorkspaces(ws, 'plan', [], { concurrency: 3 }),
      3,
    );
    await startedPromise;
    fakes[0]!.closeWith(0);
    fakes[1]!.closeWith(7);
    fakes[2]!.closeWith(0);
    await consumer;

    const done = events.find((e) => e.kind === 'done');
    if (!done || done.kind !== 'done') throw new Error('no done event');
    const codes = [...done.summary.workspaces.entries()]
      .map(([dir, code]) => [basename(dir), code] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(codes).toEqual([['x', 0], ['y', 7], ['z', 0]]);
  });

  it('emits a stderr error and exits 1 when no binary is installed', async () => {
    useFakeTool([]);

    const monoRoot = await mkMonorepo(['empty']);
    const ws = await discoverWorkspaces(monoRoot);
    const events: WorkspaceEvent[] = [];
    for await (const e of runWorkspaces(ws, 'plan', [])) {
      events.push(e);
    }
    const stderr = events
      .filter((e): e is Extract<WorkspaceEvent, { kind: 'stderr' }> => e.kind === 'stderr')
      .map((e) => e.chunk)
      .join('');
    expect(stderr).toMatch(/no installed terraform binary/);
    const exited = events.find((e) => e.kind === 'exited');
    if (exited && exited.kind === 'exited') {
      expect(exited.code).toBe(1);
    } else {
      throw new Error('no exited event');
    }
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('emits a stderr error and exits 1 when the command is unknown', async () => {
    useFakeTool(['1.6.6']);

    const monoRoot = await mkMonorepo(['nope']);
    const ws = await discoverWorkspaces(monoRoot);
    const events: WorkspaceEvent[] = [];
    for await (const e of runWorkspaces(ws, 'bogus', [])) {
      events.push(e);
    }
    const stderr = events
      .filter((e): e is Extract<WorkspaceEvent, { kind: 'stderr' }> => e.kind === 'stderr')
      .map((e) => e.chunk)
      .join('');
    expect(stderr).toMatch(/unknown command 'bogus'/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses --tool-version when present in the installed list', async () => {
    useFakeTool(['1.6.6', '1.5.3']);
    await touchBinary('1.5.3');

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);

    const monoRoot = await mkMonorepo(['pinned']);
    const ws = await discoverWorkspaces(monoRoot);

    const { events, startedPromise, consumer } = await runAndCollect(
      runWorkspaces(ws, 'plan', [], { toolVersionRef: '1.5.3' }),
      1,
    );
    await startedPromise;
    fake.closeWith(0);
    await consumer;

    const resolving = events.find((e) => e.kind === 'resolving');
    if (!resolving || resolving.kind !== 'resolving') throw new Error('no resolving event');
    expect(resolving.version).toBe('1.5.3');
  });
});
