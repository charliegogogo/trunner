import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps {
  label?: string;
  intervalMs?: number;
}

export function Spinner({ label, intervalMs = 80 }: SpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <Text>
      <Text color="cyan">{FRAMES[frame] ?? '·'}</Text>
      {label ? <Text> {label}</Text> : null}
    </Text>
  );
}
