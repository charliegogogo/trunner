import { useEffect, useState, useRef } from 'react';
import type { ProgressInfo, PromptRequest, RunnerEventMap, Runner } from '@trunner/sdk';

export type RunnerStatus = 'idle' | 'running' | 'exited';

export interface RunnerState {
  status: RunnerStatus;
  stdout: string;
  stderr: string;
  progress: ProgressInfo | null;
  progressPercent: number;
  progressLabel: string;
  statusLabel: string;
  prompt: PromptRequest | null;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  answerPrompt: ((value: string) => void) | null;
}

const INITIAL: RunnerState = {
  status: 'idle',
  stdout: '',
  stderr: '',
  progress: null,
  progressPercent: 0,
  progressLabel: '',
  statusLabel: 'preparing',
  prompt: null,
  exitCode: null,
  exitSignal: null,
  answerPrompt: null,
};

function isRunnerLike(r: unknown): r is Runner {
  return !!r && typeof r === 'object' && typeof (r as { on?: unknown }).on === 'function';
}

export function useRunner(runner: Runner | null): RunnerState {
  const [state, setState] = useState<RunnerState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!runner || !isRunnerLike(runner)) {
      setState(INITIAL);
      return;
    }

    setState((s) => ({ ...s, status: 'running', statusLabel: 'starting' }));

    const onStdout: RunnerEventMap['stdout'] = (chunk) => {
      setState((s) => ({ ...s, stdout: s.stdout + chunk, statusLabel: 'running' }));
    };
    const onStderr: RunnerEventMap['stderr'] = (chunk) => {
      setState((s) => ({ ...s, stderr: s.stderr + chunk, statusLabel: 'running' }));
    };
    const onProgress: RunnerEventMap['progress'] = (info) => {
      const total = info.total ?? 0;
      const current = info.current ?? 0;
      const percent = info.unit === 'percent'
        ? Math.max(0, Math.min(1, current / 100))
        : total > 0
          ? Math.max(0, Math.min(1, current / total))
          : 0;
      setState((s) => ({
        ...s,
        progress: info,
        progressPercent: percent,
        progressLabel: info.message ?? `${info.phase} ${current}/${total}`,
      }));
    };
    const onPrompt: RunnerEventMap['prompt'] = (req, answer) => {
      setState((s) => ({
        ...s,
        prompt: req,
        answerPrompt: answer,
        statusLabel: `awaiting input: ${req.question}`,
      }));
    };
    const onExit: RunnerEventMap['exit'] = (code, signal) => {
      setState((s) => ({
        ...s,
        status: 'exited',
        exitCode: code,
        exitSignal: signal,
        statusLabel: code === 0 ? 'done' : `exited (${code ?? signal ?? '?'})`,
      }));
    };

    runner.on('stdout', onStdout);
    runner.on('stderr', onStderr);
    runner.on('progress', onProgress);
    runner.on('prompt', onPrompt);
    runner.on('exit', onExit);

    return () => {
      runner.off('stdout', onStdout);
      runner.off('stderr', onStderr);
      runner.off('progress', onProgress);
      runner.off('prompt', onPrompt);
      runner.off('exit', onExit);
    };
  }, [runner]);

  return state;
}
