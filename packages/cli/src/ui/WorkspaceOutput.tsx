import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { WorkspaceDisplay } from '../hooks/useWorkspaces.js';

export interface WorkspaceOutputProps {
  workspace: WorkspaceDisplay;
  maxHeight: number;
  width: number;
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function lastNLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/);
  return lines.slice(-maxLines);
}

export function WorkspaceOutput({ workspace, maxHeight, width }: WorkspaceOutputProps): React.ReactElement {
  const { stdout, stderr, state, exitCode } = workspace;

  const content = useMemo(() => {
    const combined = stdout + (stderr ? `\n${stderr}` : '');
    const lines = lastNLines(combined, maxHeight - 2);
    return lines;
  }, [stdout, stderr, maxHeight]);

  return (
    <Box flexDirection="column" width={width}>
      {content.length === 0 ? (
        <Text dimColor>
          {state === 'pending' ? 'Waiting to start...' :
           state === 'resolving' ? 'Resolving tool version...' :
           'Running...'}
        </Text>
      ) : (
        content.map((line, i) => (
          <Text key={i} wrap="wrap">
            {line || ' '}
          </Text>
        ))
      )}
      {state === 'exited' && (
        <Box marginTop={1}>
          <Text dimColor>
            {exitCode === 0 ? (
              <Text color="green">✓ Completed successfully</Text>
            ) : (
              <Text color="red">✗ Failed (exit {exitCode})</Text>
            )}
          </Text>
        </Box>
      )}
    </Box>
  );
}
