import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  discoverWorkspaces,
  parseRc,
  rcPathFor,
  runWorkspaces,
  type Workspace,
  type WorkspaceEvent,
  type RunSummary,
} from '@trunner/sdk';
import { useWorkspaces } from './hooks/useWorkspaces.js';
import { StatusBar } from './ui/StatusBar.js';
import { WorkspacePane } from './ui/WorkspacePane.js';
import type { CliFlags } from './types.js';

export interface AppProps {
  command: string;
  commandArgs: string[];
  flags: CliFlags;
}

type Phase = 'discovering' | 'running' | 'done' | 'error';

interface DiscoverState {
  phase: Phase;
  workspaces: Workspace[];
  error: string | null;
  summary: RunSummary | null;
}

export function App({ command, commandArgs, flags }: AppProps): React.ReactElement {
  const [state, setState] = useState<DiscoverState>({
    phase: 'discovering',
    workspaces: [],
    error: null,
    summary: null,
  });
  const [iter, setIter] = useState<AsyncIterable<WorkspaceEvent> | null>(null);
  const ink = useApp();
  const { workspaces, focusedIndex, moveFocus, answerFocusedPrompt, summary } = useWorkspaces(
    iter,
    {
      onDone: (s) => {
        setState((cur) => ({ ...cur, phase: 'done', summary: s }));
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = await discoverWorkspaces(flags.cwd, { exclude: flags.exclude });
        if (cancelled) return;
        if (ws.length === 0) {
          // If the immediate cwd has a .trunnerrc that failed to parse,
          // discover() silently skipped it (project boundary semantic).
          // Surface the parse error so the user knows why their RC was ignored.
          const cwdAbs = resolvePath(flags.cwd);
          const cwdRc = rcPathFor(cwdAbs);
          let parseError: string | null = null;
          try {
            const st = await stat(cwdRc);
            if (st.isFile()) {
              await parseRc(cwdRc);
            }
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              parseError = (err as Error).message;
            }
          }
          const msg = parseError
            ? `${parseError}\n  (fix ${cwdRc} or pass --cwd <path> to a different directory)`
            : `no .trunnerrc found under ${flags.cwd}; cd to a project root, create a .trunnerrc, or pass --cwd <path> and -t <tool>`;
          setState({
            phase: 'error',
            workspaces: [],
            error: msg,
            summary: null,
          });
          return;
        }
        setState((cur) => ({ ...cur, phase: 'running', workspaces: ws }));
        const it = runWorkspaces(ws, command, commandArgs, {
          ...(typeof flags.concurrency === 'number' ? { concurrency: flags.concurrency } : {}),
          ...(flags.toolVersion ? { toolVersionRef: flags.toolVersion } : {}),
          ...(flags.tool ? { toolOverride: flags.tool } : {}),
          autoApprove: flags.autoApprove,
        });
        setIter(it);
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: 'error',
          workspaces: [],
          error: (err as Error).message,
          summary: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [command, commandArgs, flags.cwd, flags.exclude, flags.concurrency, flags.toolVersion, flags.tool, flags.autoApprove]);

  // Exit the Ink tree once a terminal phase (error | done) has rendered.
  // Without this the process keeps the render loop alive and the user has
  // to Ctrl+C. process.exitCode is set so the shell sees the right code
  // after ink.exit's cleanup: 0 for done-with-no-failures, 1 for any
  // workspace failure or discover error.
  useEffect(() => {
    if (state.phase !== 'error' && state.phase !== 'done') return;
    if (state.phase === 'error') {
      process.exitCode = 1;
    } else {
      const s = summary ?? state.summary;
      process.exitCode = s && s.failed > 0 ? 1 : 0;
    }
    const t = setTimeout(() => ink.exit(), 0);
    return () => clearTimeout(t);
  }, [state.phase, state.summary, summary, ink]);

  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (key.tab) {
        moveFocus(1);
        return;
      }
      if (input === 'j' || key.downArrow) {
        moveFocus(1);
        return;
      }
      if (input === 'k' || key.upArrow) {
        moveFocus(-1);
        return;
      }
      if (input === 'g') {
        moveFocus(-focusedIndex);
        return;
      }
    },
    { isActive: isRawModeSupported === true },
  );

  if (state.phase === 'error') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">error: {state.error}</Text>
      </Box>
    );
  }

  if (state.phase === 'discovering') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>discovering workspaces under {flags.cwd}…</Text>
      </Box>
    );
  }

  if (flags.quiet) {
    return <QuietSummary workspaces={workspaces} summary={summary ?? state.summary} />;
  }

  if (flags.json) {
    return <JsonStream iter={iter} />;
  }

  const focused = workspaces[focusedIndex] ?? null;
  return (
    <Box flexDirection="column" paddingX={1}>
      <StatusBar workspaces={workspaces} focusedIndex={focusedIndex} />
      {focused ? (
        <Box marginTop={1}>
          <WorkspacePane
            workspace={focused}
            command={command}
            commandArgs={commandArgs}
            autoApprove={flags.autoApprove}
            color={flags.color}
            isFocused
            onPromptAnswer={answerFocusedPrompt}
            onTab={() => moveFocus(1)}
          />
        </Box>
      ) : null}
    </Box>
  );
}

function QuietSummary({
  workspaces,
  summary,
}: {
  workspaces: { dir: string; exitCode: number | null; state: string }[];
  summary: RunSummary | null;
}): React.ReactElement {
  if (!summary) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>(running…)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        {summary.succeeded} succeeded, {summary.failed} failed (of {summary.total})
      </Text>
      {workspaces.map((w) => (
        <Text key={w.dir}>
          {w.dir}: {w.state === 'exited' ? (w.exitCode === 0 ? 'ok' : `exit ${w.exitCode ?? '?'}`) : w.state}
        </Text>
      ))}
    </Box>
  );
}

function JsonStream({ iter }: { iter: AsyncIterable<WorkspaceEvent> | null }): React.ReactElement {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!iter) return;
    let cancelled = false;
    (async () => {
      try {
        for await (const e of iter) {
          if (cancelled) return;
          setLines((cur) => [...cur, JSON.stringify(e)]);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [iter]);
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
    </Box>
  );
}
