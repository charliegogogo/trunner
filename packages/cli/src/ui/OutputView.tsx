import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface OutputViewProps {
  stdout: string;
  stderr: string;
  maxLines?: number;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function clip(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const dropped = lines.length - maxLines;
  return `… (${dropped} earlier line(s) hidden)\n${lines.slice(-maxLines).join('\n')}`;
}

export function OutputView({ stdout, stderr, maxLines = 50 }: OutputViewProps): React.ReactElement {
  const out = useMemo(() => stripAnsi(clip(stdout, maxLines)), [stdout, maxLines]);
  const err = useMemo(() => stripAnsi(clip(stderr, Math.max(10, Math.floor(maxLines / 3)))), [stderr, maxLines]);

  if (!out && !err) {
    return (
      <Box marginY={1}>
        <Text dimColor>(no output yet)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {out ? (
        <Box flexDirection="column">
          {out.split('\n').map((line, i) => (
            <Text key={`o-${i}`}>{line}</Text>
          ))}
        </Box>
      ) : null}
      {err ? (
        <Box flexDirection="column" marginTop={1}>
          {err.split('\n').map((line, i) => (
            <Text key={`e-${i}`} color="red">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
