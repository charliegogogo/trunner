import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import {
  discoverWorkspaces,
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
          setState({
            phase: 'error',
            workspaces: [],
            error: `no .trunnerrc found under ${flags.cwd}; cd to a project root, create a .trunnerrc, or pass --cwd <path> and -t <tool>`,
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
