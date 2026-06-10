import React from 'react';
import { Box, Text } from 'ink';
import type { WorkingDirDisplay } from '../hooks/useWorkingDirs.js';
import type { RunSummary } from '@trunner/sdk';

export interface QuietModeProps {
  workingDirs: WorkingDirDisplay[];
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

export function QuietMode({ workingDirs, summary, width, height }: QuietModeProps): React.ReactElement {
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
          <Text dimColor>discovering working directories...</Text>
        )}
      </Box>

      {/* Results */}
      {summary ? (
        <Box flexDirection="column" paddingX={1}>
          {workingDirs.map((wd) => {
            const elapsed = wd.endedAt ? wd.endedAt - wd.startedAt : now - wd.startedAt;
            const elapsedStr = (elapsed / 1000).toFixed(1) + 's';
            if (wd.state === 'exited') {
              if (wd.exitCode === 0 && wd.parsedResult?.changes) {
                const { add, change, destroy } = wd.parsedResult.changes;
                const resultType = wd.parsedResult.resultType ?? 'plan';
                let resultText: string;
                if (resultType === 'apply') {
                  resultText = `Apply complete! Resources: ${add} added, ${change} changed, ${destroy} destroyed.`;
                } else if (resultType === 'destroy') {
                  resultText = `Destroy complete! Resources: ${destroy} destroyed.`;
                } else {
                  resultText = `Plan: ${add} to add, ${change} to change, ${destroy} to destroy.`;
                }
                return (
                  <Box key={wd.dir} flexDirection="row">
                    <Text color="magenta">✓</Text>
                    <Text> </Text>
                    <Text bold>{shortDir(wd.dir)}</Text>
                    <Text dimColor>: </Text>
                    <Text color="green">{resultText}</Text>
                    <Text dimColor> ({elapsedStr})</Text>
                  </Box>
                );
              } else if (wd.exitCode === 0) {
                return (
                  <Box key={wd.dir} flexDirection="row">
                    <Text color="magenta">✓</Text>
                    <Text> </Text>
                    <Text bold>{shortDir(wd.dir)}</Text>
                    <Text dimColor>: </Text>
                    <Text color="green">ok</Text>
                    <Text dimColor> ({elapsedStr})</Text>
                  </Box>
                );
              } else {
                return (
                  <Box key={wd.dir} flexDirection="column">
                    <Box flexDirection="row">
                      <Text color="red">✗</Text>
                      <Text> </Text>
                      <Text bold>{shortDir(wd.dir)}</Text>
                      <Text dimColor>: </Text>
                      <Text color="red">failed (exit {wd.exitCode ?? '?'})</Text>
                      <Text dimColor> ({elapsedStr})</Text>
                    </Box>
                    {wd.parsedResult?.errors && wd.parsedResult.errors.length > 0 && (
                      <Text dimColor>  {wd.parsedResult.errors[0]}</Text>
                    )}
                    {wd.stderr.trim() && <Text dimColor>{wd.stderr.trim()}</Text>}
                  </Box>
                );
              }
            } else {
              return (
                <Box key={wd.dir} flexDirection="row">
                  <Text color="cyan">○</Text>
                  <Text> </Text>
                  <Text bold>{shortDir(wd.dir)}</Text>
                  <Text dimColor>: </Text>
                  <Text color="cyan">{wd.state}</Text>
                  <Text dimColor> ({elapsedStr})</Text>
                </Box>
              );
            }
          })}
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>· discovering working directories...</Text>
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
