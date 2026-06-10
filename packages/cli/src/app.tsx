import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  discoverWorkspaces,
  rcPathFor,
  parseRc,
  runWorkspaces,
  type Workspace,
  type WorkspaceEvent,
  type RunSummary,
} from '@trunner/sdk';
import { useWorkspaces, type WorkspaceDisplay } from './hooks/useWorkspaces.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { ExecutionView } from './ui/ExecutionView.js';
import { InteractiveWizard, type InteractiveWizardResult } from './ui/InteractiveWizard.js';
import { ManagementView } from './ui/ManagementView.js';
import type { CliFlags } from './types.js';

export interface AppProps {
  command: string | null;
  commandArgs: string[];
  flags: CliFlags;
  interactiveMode: boolean;
  /** Called when the app is about to exit with results to print to stdout. */
  onExit?: (results: string) => void;
}

type Phase = 'discovering' | 'running' | 'done' | 'error';

interface DiscoverState {
  phase: Phase;
  workspaces: Workspace[];
  error: string | null;
  summary: RunSummary | null;
}

function shortDir(dir: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && dir.startsWith(home)) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}

function formatResults(workspaces: WorkspaceDisplay[], summary: RunSummary | null, command: string | null): string {
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const total = summary?.total ?? workspaces.length;
  const succeeded = summary?.succeeded ?? workspaces.filter((w) => w.exitCode === 0).length;
  const failed = summary?.failed ?? workspaces.filter((w) => w.exitCode !== 0).length;

  const lines: string[] = [];
  lines.push('');

  // Summary line
  const cmd = command ?? 'plan';
  if (failed === 0) {
    lines.push(`${BOLD}trunner${RESET} executed ${BOLD}${cmd}${RESET} for ${BOLD}${total}${RESET} working director${total === 1 ? 'y' : 'ies'} — ${GREEN}${succeeded} succeeded${RESET}`);
  } else {
    lines.push(`${BOLD}trunner${RESET} executed ${BOLD}${cmd}${RESET} for ${BOLD}${total}${RESET} working director${total === 1 ? 'y' : 'ies'} — ${GREEN}${succeeded} succeeded${RESET}, ${RED}${failed} failed${RESET}`);
  }
  lines.push('');

  // Table header
  const now = Date.now();
  const dirWidth = Math.max(20, ...workspaces.map((w) => shortDir(w.dir).length));
  lines.push(`${BOLD}${'Working Directory'.padEnd(dirWidth)}  ${'Status'.padEnd(12)}  ${'Result'}${RESET}`);
  lines.push(`${'─'.repeat(dirWidth)}  ${'─'.repeat(12)}  ${'─'.repeat(30)}`);

  // Table rows
  for (const ws of workspaces) {
    const elapsed = ws.endedAt ? ws.endedAt - ws.startedAt : now - ws.startedAt;
    const elapsedStr = (elapsed / 1000).toFixed(1) + 's';
    const dir = shortDir(ws.dir);

    if (ws.state === 'exited') {
      if (ws.exitCode === 0 && ws.parsedResult?.changes) {
        const { add, change, destroy } = ws.parsedResult.changes;
        const result = `Plan: ${add} to add, ${change} to change, ${destroy} to destroy.`;
        lines.push(`${GREEN}${dir.padEnd(dirWidth)}  ${'✓ success'.padEnd(12)}  ${result} ${DIM}(${elapsedStr})${RESET}`);
      } else if (ws.exitCode === 0) {
        lines.push(`${GREEN}${dir.padEnd(dirWidth)}  ${'✓ success'.padEnd(12)}  ${DIM}(${elapsedStr})${RESET}`);
      } else {
        const result = ws.parsedResult?.errors?.[0] ?? `failed (exit ${ws.exitCode ?? '?'})`;
        lines.push(`${RED}${dir.padEnd(dirWidth)}  ${'✗ failed'.padEnd(12)}  ${result} ${DIM}(${elapsedStr})${RESET}`);
      }
    } else {
      lines.push(`${DIM}${dir.padEnd(dirWidth)}  ${ws.state.padEnd(12)}  ${DIM}(${elapsedStr})${RESET}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function App({ command, commandArgs, flags, interactiveMode, onExit }: AppProps): React.ReactElement {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [defaultRc, setDefaultRc] = useState<any>(null);
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [interactiveCategory, setInteractiveCategory] = useState<'run' | 'manage' | null>(null);
  const [managementTarget, setManagementTarget] = useState<'tools' | 'providers' | null>(null);
  const [detectedTool, setDetectedTool] = useState<'terraform' | 'opentofu' | 'mixed' | null>(null);

  useEffect(() => {
    if (!interactiveMode) return;
    (async () => {
      try {
        const cwdAbs = resolvePath(flags.cwd);
        const cwdRc = rcPathFor(cwdAbs);
        const st = await stat(cwdRc);
        if (st.isFile()) {
          const result = await parseRc(cwdRc);
          setDefaultRc(result.config);
        }
      } catch {
        setDefaultRc(null);
      }

      // Scan all subdirectories to detect mixed tools
      try {
        const workspaces = await discoverWorkspaces(flags.cwd, { exclude: flags.exclude });
        const tools = new Set(workspaces.map((ws) => ws.config.tool));
        if (tools.size > 1) {
          setDetectedTool('mixed');
        } else if (tools.size === 1) {
          const tool = workspaces[0]?.config.tool;
          setDetectedTool(tool ?? 'terraform');
        } else {
          setDetectedTool('terraform');
        }
      } catch {
        setDetectedTool('terraform');
      }
    })();
  }, [interactiveMode, flags.cwd, flags.exclude]);

  const { width: termWidth, height: termHeight } = useTerminalSize();

  if (interactiveMode) {
    // Show ManagementView if in manage category (not for "mixed")
    if (interactiveCategory === 'manage' && managementTarget && selectedTool && selectedTool !== 'mixed') {
      return (
        <ManagementView
          tool={selectedTool}
          target={managementTarget}
          width={termWidth}
          height={termHeight}
          onExit={() => {
            setInteractiveCategory(null);
            setManagementTarget(null);
            setSelectedCommand(null);
          }}
        />
      );
    }

    // Show ExecutionView if in run category with command selected
    if (interactiveCategory === 'run' && selectedCommand && selectedTool) {
      // When "mixed" is selected, don't pass tool override - let each workspace use its own tool
      const toolOverride = selectedTool === 'mixed' ? undefined : selectedTool;
      return (
        <App
          command={selectedCommand}
          commandArgs={commandArgs}
          flags={{ ...flags, ...(toolOverride ? { tool: toolOverride } : {}) }}
          interactiveMode={false}
          onExit={onExit}
        />
      );
    }

    // Show InteractiveWizard
    return (
      <InteractiveWizard
        defaultRc={defaultRc}
        detectedTool={detectedTool}
        onComplete={(result: InteractiveWizardResult) => {
          setSelectedTool(result.tool);
          setInteractiveCategory(result.category);
          if (result.category === 'run') {
            setSelectedCommand(result.command);
          } else if (result.category === 'manage' && result.managementTarget) {
            setManagementTarget(result.managementTarget);
          }
        }}
      />
    );
  }

  const [state, setState] = useState<DiscoverState>({
    phase: 'discovering',
    workspaces: [],
    error: null,
    summary: null,
  });
  const [iter, setIter] = useState<AsyncIterable<WorkspaceEvent> | null>(null);
  const ink = useApp();
  const { isRawModeSupported } = useStdin();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { workspaces, summary, moveFocus } = useWorkspaces(
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
        const it = runWorkspaces(ws, command ?? '', commandArgs, {
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

  const keepAlive = process.env['TR_KEEP_ALIVE'] !== '0';

  useInput(
    (_input, key) => {
      // Exit on Esc
      if (key.escape && (state.phase === 'done' || state.phase === 'error')) {
        if (state.phase === 'done') {
          onExit?.(formatResults(workspaces, summary ?? state.summary, command));
        } else if (state.error) {
          onExit?.(`error: ${state.error}`);
        }
        ink.exit();
      }

      // Tab switching with arrow keys
      if (state.phase === 'running' || state.phase === 'done') {
        if (key.leftArrow) {
          // Previous workspace
          setFocusedIndex((prev) => Math.max(0, prev - 1));
          setScrollOffset(0);
        }
        if (key.rightArrow) {
          // Next workspace
          setFocusedIndex((prev) => Math.min(workspaces.length - 1, prev + 1));
          setScrollOffset(0);
        }
      }

      // Scroll output with arrow keys
      if (_input === 'j' || key.downArrow) {
        setScrollOffset((prev) => prev + 1);
      }
      if (_input === 'k' || key.upArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
      }
    },
    { isActive: isRawModeSupported === true },
  );

  useEffect(() => {
    if (state.phase === 'error') {
      process.exitCode = 1;
      if (!keepAlive) {
        const t = setTimeout(() => {
          onExit?.(`error: ${state.error}`);
          ink.exit();
        }, 2000);
        return () => clearTimeout(t);
      }
    } else if (state.phase === 'done') {
      const s = summary ?? state.summary;
      process.exitCode = s && s.failed > 0 ? 1 : 0;
      if (!keepAlive) {
        const t = setTimeout(() => {
          onExit?.(formatResults(workspaces, summary ?? state.summary, command));
          ink.exit();
        }, 1000);
        return () => clearTimeout(t);
      }
    }
  }, [state.phase, state.summary, summary, ink, keepAlive, workspaces, onExit]);

  if (state.phase === 'error') {
    return (
      <Box flexDirection="column" width={termWidth} height={termHeight}>
        <Box
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          width={termWidth}
        >
          <Text color="red">error: {state.error}</Text>
        </Box>
        {keepAlive && (
          <Box
            borderStyle="round"
            borderColor="magenta"
            paddingX={1}
            width={termWidth}
            marginTop={1}
          >
            <Text dimColor>Press Esc to exit</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (state.phase === 'discovering') {
    return (
      <Box flexDirection="column" width={termWidth} height={termHeight}>
        <Box
          borderStyle="round"
          borderColor="magenta"
          paddingX={1}
          width={termWidth}
        >
          <Text bold color="magenta">trunner</Text>
          <Text dimColor> │ </Text>
          <Text dimColor>discovering workspaces...</Text>
        </Box>
      </Box>
    );
  }

  // Show ExecutionView for both running and done phases (carousel view)
  return (
    <ExecutionView
      workspaces={workspaces}
      focusedIndex={focusedIndex}
      scrollOffset={scrollOffset}
      isComplete={state.phase === 'done'}
      width={termWidth}
      height={termHeight}
    />
  );
}
