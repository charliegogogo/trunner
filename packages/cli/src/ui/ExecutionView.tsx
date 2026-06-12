import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { WorkingDirDisplay } from '../hooks/useWorkingDirs.js';
import { TabBar } from './TabBar.js';

export interface ExecutionViewProps {
  workingDirs: WorkingDirDisplay[];
  focusedIndex: number;
  scrollOffset: number;
  isComplete: boolean;
  width: number;
  height: number;
}

function shortDir(dir: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && dir.startsWith(home)) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}

function stateIcon(state: WorkingDirDisplay['state'], exitCode: number | null): string {
  if (state === 'exited') {
    return exitCode === 0 ? '✓' : '✗';
  }
  if (state === 'running') return '●';
  if (state === 'resolving') return '◌';
  return '○';
}

function stateColor(state: WorkingDirDisplay['state'], exitCode: number | null): Parameters<typeof Text>[0]['color'] {
  if (state === 'exited') {
    return exitCode === 0 ? 'green' : 'red';
  }
  if (state === 'running') return 'yellow';
  if (state === 'resolving') return 'cyan';
  return 'gray';
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function ExecutionView({ workingDirs, focusedIndex, scrollOffset, isComplete, width, height }: ExecutionViewProps): React.ReactElement {
  const tabHeight = 3;
  const outputHeight = height - tabHeight - 3;
  const focused = workingDirs[focusedIndex];

  const content = useMemo(() => {
    if (!focused) return [];
    const combined = focused.stdout + (focused.stderr ? `\n${focused.stderr}` : '');
    const lines = combined.split(/\r?\n/);
    // Apply scroll offset (from bottom)
    const startIdx = Math.max(0, lines.length - outputHeight - scrollOffset);
    const endIdx = Math.min(lines.length, startIdx + outputHeight);
    return lines.slice(startIdx, endIdx);
  }, [focused?.stdout, focused?.stderr, outputHeight, scrollOffset]);

  const tabs = workingDirs.map((wd) => ({
    label: shortDir(wd.dir),
    icon: stateIcon(wd.state, wd.exitCode),
  }));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Tab bar with purple border */}
      <TabBar
        tabs={tabs}
        activeIndex={focusedIndex}
        suffix={
          <Text dimColor>{workingDirs.length} working director{workingDirs.length === 1 ? 'y' : 'ies'}</Text>
        }
        width={width}
      />

      {/* Working directory output with purple border */}
      {focused && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          width={width}
          flexGrow={1}
        >
          <Box marginBottom={1}>
            <Text bold color="magenta">{shortDir(focused.dir)}</Text>
            <Text dimColor> │ </Text>
            <Text color={stateColor(focused.state, focused.exitCode)}>
              {focused.state}
            </Text>
            {focused.version && (
              <>
                <Text dimColor> │ </Text>
                <Text dimColor>{focused.toolId} {focused.version}</Text>
              </>
            )}
            {isComplete && (
              <>
                <Text dimColor> │ </Text>
                <Text color={focused.exitCode === 0 ? 'green' : 'red'}>
                  {focused.exitCode === 0 ? '✓ completed' : `✗ failed (exit ${focused.exitCode})`}
                </Text>
              </>
            )}
          </Box>
          <Box flexDirection="column" height={outputHeight}>
            {content.length === 0 ? (
              <Text dimColor>
                {focused.state === 'pending' ? 'Waiting to start...' :
                 focused.state === 'resolving' ? 'Resolving tool version...' :
                 'Running...'}
              </Text>
            ) : (
              content.map((line, i) => (
                <Text key={i} wrap="wrap">
                  {line || ' '}
                </Text>
              ))
            )}
          </Box>
        </Box>
      )}

      {/* Status bar without border */}
      <Box
        flexDirection="row"
        paddingX={1}
        width={width}
      >
        <Text dimColor>
          {'←/→'} switch tabs │ {'↑/↓'} scroll │ Esc exit │ {isComplete ? 'Done' : 'Running...'}
        </Text>
      </Box>
    </Box>
  );
}
