import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RunnerStream, type Runner } from './stream.js';
import { parsePlanAndApplyOutput } from './parser.js';
import type { CommandResult } from '../types/result.js';
import type { Logger } from '../utils/logger.js';
import { NoopLogger } from '../utils/logger.js';
import { getPaths, type TrunnerPaths } from '../env/paths.js';

export interface RunSpec {
  binaryPath: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  runId?: string;
}

export interface RunOptions {
  logger?: Logger;
  paths?: TrunnerPaths;
  parseOutput?: boolean;
}

export type CreateRunnerOptions = RunOptions;

export type RunnerHandle = Runner & { run: (spec: RunSpec) => Promise<CommandResult> };

export function createRunner(opts: CreateRunnerOptions = {}): RunnerHandle {
  const logger = opts.logger ?? new NoopLogger();
  const paths = opts.paths ?? getPaths();
  const stream = new RunnerStream();
  const inflight = new Set<AbortController>();

  const handle: RunnerHandle = {
    on: ((event: string, listener: (...args: unknown[]) => void) =>
      (stream.on as unknown as (e: string, l: (...a: unknown[]) => void) => RunnerStream)(
        event,
        listener,
      )) as unknown as RunnerHandle['on'],
    off: ((event: string, listener: (...args: unknown[]) => void) =>
      (stream.off as unknown as (e: string, l: (...a: unknown[]) => void) => RunnerStream)(
        event,
        listener,
      )) as unknown as RunnerHandle['off'],
    cancel: async (signal?: AbortSignal) => {
      for (const ctl of inflight) ctl.abort(signal?.reason ?? 'cancelled');
    },
    run: (spec) =>
      runCommand(spec, { logger, paths, stream, inflight, parseOutput: opts.parseOutput ?? true }),
  };
  return handle;
}

interface InternalOptions {
  logger: Logger;
  paths: TrunnerPaths;
  stream: RunnerStream;
  inflight: Set<AbortController>;
  parseOutput: boolean;
}

async function runCommand(spec: RunSpec, opts: InternalOptions): Promise<CommandResult> {
  const start = Date.now();
  const { logger, stream, inflight, parseOutput } = opts;

  const ac = new AbortController();
  if (spec.signal) {
    if (spec.signal.aborted) {
      throw new Error('Run aborted before start');
    }
    spec.signal.addEventListener('abort', () => ac.abort(spec.signal?.reason), { once: true });
  }
  inflight.add(ac);

  const env = buildEnv(spec, opts);
  // Ensure plugin cache directory exists before spawning terraform
  try {
    mkdirSync(env.TF_PLUGIN_CACHE_DIR!, { recursive: true });
  } catch {
    // Ignore errors if directory already exists or cannot be created
  }
  logger.debug('spawning', { binary: spec.binaryPath, args: spec.args, cwd: spec.cwd });

  let child: ChildProcess;
  try {
    child = spawn(spec.binaryPath, spec.args, {
      cwd: spec.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal: ac.signal,
    });
  } catch (err) {
    inflight.delete(ac);
    throw err;
  }

  let stdout = '';
  let stderr = '';

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');

  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
    stream.emitStdout(chunk);
    detectPrompt(chunk, stream);
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
    stream.emitStderr(chunk);
  });

  // Wait for both stdout and stderr to end before resolving, so callers can
  // be sure all data has been captured in the returned result.
  const streamsDone = Promise.all([
    streamToPromise(child.stdout),
    streamToPromise(child.stderr),
  ]);

  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      inflight.delete(ac);
      logger.error('spawn error', { err: err.message });
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      // Defer resolution until all stdout/stderr data has been consumed.
      void streamsDone.then(() => {
        if (settled) return;
        settled = true;
        inflight.delete(ac);
        const parsed = parseOutput
          ? parsePlanAndApplyOutput(stdout, stderr, { includeDiagnostics: true })
          : undefined;
        stream.emitExit(code, signal);
        resolve({
          exitCode: code,
          signal,
          durationMs: Date.now() - start,
          stdout,
          stderr,
          ...(parsed ? { parsed } : {}),
        });
      });
    });
  });
}

function streamToPromise(stream: NodeJS.ReadableStream | null): Promise<void> {
  return new Promise((resolve) => {
    if (!stream) return resolve();
    const s = stream as NodeJS.ReadableStream & { readableEnded?: boolean };
    if (s.readableEnded) return resolve();
    stream.once('end', () => resolve());
    stream.once('close', () => resolve());
  });
}

function detectPrompt(chunk: string, stream: RunnerStream): void {
  if (/Do you want to perform these actions\?/i.test(chunk)) {
    stream.emitPrompt(
      {
        promptId: `prompt-${Date.now()}`,
        question: 'Do you want to perform these actions?',
        kind: 'confirm',
        defaultValue: 'no',
      },
      () => {
        /* answers are expected to be provided via the runner's flag plumbing; this is informational */
      },
    );
    return;
  }
  if (/Do you really want to destroy all resources\?/i.test(chunk)) {
    stream.emitPrompt(
      {
        promptId: `prompt-${Date.now()}`,
        question: 'Do you really want to destroy all resources?',
        kind: 'confirm',
        defaultValue: 'no',
      },
      () => {
        /* see above */
      },
    );
  }
}

function buildEnv(spec: RunSpec, opts: InternalOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...spec.env };
  env.TF_PLUGIN_CACHE_DIR = join(opts.paths.providers, 'terraform', 'plugins');
  return env;
}
