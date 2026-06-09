import { useEffect, useRef, useState, useCallback } from 'react';
import { parsePlanAndApplyOutput } from '@trunner/sdk';
import type {
  ProgressInfo,
  PromptRequest,
  PromptAnswer,
  TrunnerRc,
  WorkspaceEvent,
  RunSummary,
  ParsedSummary,
} from '@trunner/sdk';

export type WorkspaceState = 'pending' | 'resolving' | 'running' | 'exited';

export interface WorkspaceDisplay {
  readonly dir: string;
  readonly config: TrunnerRc;
  state: WorkspaceState;
  toolId: string | null;
  version: string | null;
  stdout: string;
  stderr: string;
  progress: ProgressInfo | null;
  progressPercent: number;
  progressLabel: string;
  prompt: { req: PromptRequest; answer: PromptAnswer } | null;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  startedAt: number;
  endedAt: number | null;
  parsedResult: ParsedSummary | null;
}

export interface UseWorkspacesResult {
  workspaces: WorkspaceDisplay[];
  focusedIndex: number;
  setFocusedIndex: (i: number) => void;
  moveFocus: (delta: number) => void;
  answerFocusedPrompt: (value: string) => void;
  summary: RunSummary | null;
}

export interface UseWorkspacesOptions {
  onDone?: (summary: RunSummary) => void;
}

function initial(dir: string, config: TrunnerRc): WorkspaceDisplay {
  return {
    dir,
    config,
    state: 'pending',
    toolId: null,
    version: null,
    stdout: '',
    stderr: '',
    progress: null,
    progressPercent: 0,
    progressLabel: '',
    prompt: null,
    exitCode: null,
    exitSignal: null,
    startedAt: Date.now(),
    endedAt: null,
    parsedResult: null,
  };
}

function progressPercentOf(info: ProgressInfo): number {
  if (info.unit === 'percent') {
    return Math.max(0, Math.min(1, info.current / 100));
  }
  if (info.total > 0) {
    return Math.max(0, Math.min(1, info.current / info.total));
  }
  return 0;
}

export function useWorkspaces(
  iter: AsyncIterable<WorkspaceEvent> | null,
  options: UseWorkspacesOptions = {},
): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceDisplay[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const promptAnswersRef = useRef<Map<string, PromptAnswer>>(new Map());
  const onDoneRef = useRef(options.onDone);
  onDoneRef.current = options.onDone;

  useEffect(() => {
    if (!iter) {
      setWorkspaces([]);
      setSummary(null);
      return;
    }

    setWorkspaces([]);
    setSummary(null);
    promptAnswersRef.current.clear();

    let cancelled = false;

    (async () => {
      try {
        for await (const e of iter) {
          if (cancelled) return;
          if (e.kind === 'started') {
            setWorkspaces((prev) => [...prev, initial(e.workspace.dir, e.workspace.config)]);
          } else if (e.kind === 'resolving') {
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.dir === e.workspace.dir
                  ? { ...w, state: 'resolving', toolId: e.toolId, version: e.version }
                  : w,
              ),
            );
          } else if (e.kind === 'stdout') {
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.dir === e.workspace.dir
                  ? { ...w, stdout: w.stdout + e.chunk, state: 'running' as const }
                  : w,
              ),
            );
          } else if (e.kind === 'stderr') {
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.dir === e.workspace.dir
                  ? { ...w, stderr: w.stderr + e.chunk, state: 'running' as const }
                  : w,
              ),
            );
          } else if (e.kind === 'progress') {
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.dir === e.workspace.dir
                  ? {
                      ...w,
                      progress: e.info,
                      progressPercent: progressPercentOf(e.info),
                      progressLabel: e.info.message ?? `${e.info.phase} ${e.info.current}/${e.info.total}`,
                      state: 'running' as const,
                    }
                  : w,
              ),
            );
          } else if (e.kind === 'prompt') {
            promptAnswersRef.current.set(e.workspace.dir, e.answer);
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.dir === e.workspace.dir
                  ? { ...w, prompt: { req: e.req, answer: e.answer } }
                  : w,
              ),
            );
          } else if (e.kind === 'exited') {
            setWorkspaces((prev) =>
              prev.map((w) => {
                if (w.dir !== e.workspace.dir) return w;
                const parsedResult = parsePlanAndApplyOutput(w.stdout, w.stderr, { includeDiagnostics: e.code !== 0 });
                return {
                  ...w,
                  state: 'exited',
                  exitCode: e.code,
                  exitSignal: e.signal,
                  endedAt: Date.now(),
                  prompt: null,
                  parsedResult,
                };
              }),
            );
            promptAnswersRef.current.delete(e.workspace.dir);
          } else if (e.kind === 'done') {
            setSummary(e.summary);
            onDoneRef.current?.(e.summary);
          }
        }
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error('useWorkspaces: iterator error', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [iter]);

  const setFocused = useCallback((i: number) => {
    setFocusedIndex(Math.max(0, i));
  }, []);

  const moveFocus = useCallback((delta: number) => {
    setFocusedIndex((cur) => Math.max(0, cur + delta));
  }, []);

  const answerFocusedPrompt = useCallback(
    (value: string) => {
      const focused = workspaces[focusedIndex];
      if (focused) {
        const answer = promptAnswersRef.current.get(focused.dir);
        if (answer) answer(value);
      }
    },
    [workspaces, focusedIndex],
  );

  return {
    workspaces,
    focusedIndex,
    setFocusedIndex: setFocused,
    moveFocus,
    answerFocusedPrompt,
    summary,
  };
}
