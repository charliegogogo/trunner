import React from 'react';
import { Box, Text } from 'ink';

export interface ProgressBarProps {
  value: number;
  width?: number;
  label?: string;
}

export function ProgressBar({ value, width = 30, label }: ProgressBarProps): React.ReactElement {
  const pct = Math.max(0, Math.min(1, value));
  const filled = Math.round(pct * width);
  const empty = Math.max(0, width - filled);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return (
    <Box>
      <Text color="green">[{bar}]</Text>
      <Text> {Math.round(pct * 100).toString().padStart(3)}%</Text>
      {label ? <Text dimColor>  {label}</Text> : null}
    </Box>
  );
}
