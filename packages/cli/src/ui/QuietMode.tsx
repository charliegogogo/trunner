import React from 'react';
import { Box, Text } from 'ink';
import type { WorkspaceDisplay } from '../hooks/useWorkspaces.js';
import type { RunSummary } from '@trunner/sdk';

export interface QuietModeProps {
  workspaces: WorkspaceDisplay[];
  summary: RunSummary | null;
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

export function QuietMode({ workspaces, summary, width, height }: QuietModeProps): React.ReactElement {
  const now = Date.now();

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        width={width}
        marginBottom={1}
      >
        <Text bold color="magenta">trunner</Text>
        <Text dimColor> │ </Text>
        {summary ? (
          <Text>{summary.total} working director{summary.total === 1 ? 'y' : 'ies'}</Text>
        ) : (
          <Text dimColor>discovering workspaces...</Text>
        )}
      </Box>

      {/* Results */}
      {summary ? (
        <Box flexDirection="column" paddingX={1}>
          {workspaces.map((ws) => {
            const elapsed = ws.endedAt ? ws.endedAt - ws.startedAt : now - ws.startedAt;
            const elapsedStr = (elapsed / 1000).toFixed(1) + 's';
            if (ws.state === 'exited') {
              if (ws.exitCode === 0 && ws.parsedResult?.changes) {
                const { add, change, destroy } = ws.parsedResult.changes;
                const resultType = ws.parsedResult.resultType ?? 'plan';
                let resultText: string;
                if (resultType === 'apply') {
                  resultText = `Apply complete! Resources: ${add} added, ${change} changed, ${destroy} destroyed.`;
                } else if (resultType === 'destroy') {
                  resultText = `Destroy complete! Resources: ${destroy} destroyed.`;
                } else {
                  resultText = `Plan: ${add} to add, ${change} to change, ${destroy} to destroy.`;
                }
                return (
                  <Box key={ws.dir} flexDirection="row">
                    <Text color="magenta">✓</Text>
                    <Text> </Text>
                    <Text bold>{shortDir(ws.dir)}</Text>
                    <Text dimColor>: </Text>
                    <Text color="green">{resultText}</Text>
                    <Text dimColor> ({elapsedStr})</Text>
                  </Box>
                );
              } else if (ws.exitCode === 0) {
                return (
                  <Box key={ws.dir} flexDirection="row">
                    <Text color="magenta">✓</Text>
                    <Text> </Text>
                    <Text bold>{shortDir(ws.dir)}</Text>
                    <Text dimColor>: </Text>
                    <Text color="green">ok</Text>
                    <Text dimColor> ({elapsedStr})</Text>
                  </Box>
                );
              } else {
                return (
                  <Box key={ws.dir} flexDirection="column">
                    <Box flexDirection="row">
                      <Text color="red">✗</Text>
                      <Text> </Text>
                      <Text bold>{shortDir(ws.dir)}</Text>
                      <Text dimColor>: </Text>
                      <Text color="red">failed (exit {ws.exitCode ?? '?'})</Text>
                      <Text dimColor> ({elapsedStr})</Text>
                    </Box>
                    {ws.parsedResult?.errors && ws.parsedResult.errors.length > 0 && (
                      <Text dimColor>  {ws.parsedResult.errors[0]}</Text>
                    )}
                    {ws.stderr.trim() && <Text dimColor>{ws.stderr.trim()}</Text>}
                  </Box>
                );
              }
            } else {
              return (
                <Box key={ws.dir} flexDirection="row">
                  <Text color="cyan">○</Text>
                  <Text> </Text>
                  <Text bold>{shortDir(ws.dir)}</Text>
                  <Text dimColor>: </Text>
                  <Text color="cyan">{ws.state}</Text>
                  <Text dimColor> ({elapsedStr})</Text>
                </Box>
              );
            }
          })}
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>· discovering workspaces...</Text>
        </Box>
      )}

      {/* Footer */}
      <Box
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        width={width}
        marginTop={1}
      >
        <Text dimColor>Press Esc to exit</Text>
      </Box>
    </Box>
  );
}
