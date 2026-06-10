import React from 'react';
import { Box, Text } from 'ink';
import type { WorkingDirDisplay } from '../hooks/useWorkspaces.js';

export interface StatusBarProps {
  workspaces: WorkingDirDisplay[];
  focusedIndex: number;
}

function formatState(ws: WorkingDirDisplay): { text: string; color: string } {
  switch (ws.state) {
    case 'pending':
      return { text: 'pending', color: 'gray' };
    case 'resolving':
      return { text: `resolving (${ws.toolId ?? '?'}${ws.version ? ` ${ws.version}` : ''})`, color: 'blue' };
    case 'running': {
      const phase = ws.progress?.phase ?? 'running';
      return { text: phase, color: 'cyan' };
    }
    case 'exited': {
      if (ws.exitCode === 0) return { text: 'done', color: 'green' };
      const code = ws.exitCode ?? ws.exitSignal ?? '?';
      return { text: `failed (exit ${code})`, color: 'red' };
    }
  }
}

function formatElapsed(startedAt: number, endedAt: number | null, now: number): string {
  const end = endedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

export function StatusBar({ workspaces, focusedIndex }: StatusBarProps): React.ReactElement {
  // Width is owned by Yoga: the outer flex-column root is sized to the
  // terminal by Ink, and width="100%" makes this box fill it. On resize,
  // Ink's internal 'resize' handler calls log.clear() + calculateLayout()
  // + onRender() (see ink.tsx:resized), which re-flows this box through
  // Yoga without any React state change on our side. We do NOT subscribe
  // to stdout's 'resize' here on purpose — adding a second listener races
  // with Ink's and causes a second throttled write that doesn't go through
  // log.clear(), leaving stale border / text cells on screen.
  const now = Date.now();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      width="100%"
      flexShrink={0}
    >
      <Box marginBottom={1}>
        <Text bold>trunner</Text>
        <Text dimColor> · {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</Text>
      </Box>
      {workspaces.length === 0 ? (
        <Text dimColor>(discovering…)</Text>
      ) : (
        workspaces.map((ws, i) => {
          const isFocused = i === focusedIndex;
          const { text: stateText, color: stateColor } = formatState(ws);
          const elapsed = formatElapsed(ws.startedAt, ws.endedAt, now);
          const marker = isFocused ? '▶' : ' ';
          return (
            <Box key={ws.dir} flexDirection="row">
              <Text color={isFocused ? 'green' : undefined}>
                {marker}{' '}
                <Text color={isFocused ? 'green' : undefined} bold={isFocused}>
                  {shortDir(ws.dir)}
                </Text>
                {' · '}
                <Text color={stateColor as Parameters<typeof Text>[0]['color']}>{stateText}</Text>
                {' · '}
                <Text dimColor>{elapsed}</Text>
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function shortDir(dir: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && dir.startsWith(home)) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}
