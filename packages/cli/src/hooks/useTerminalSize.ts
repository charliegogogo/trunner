import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize(): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ width: stdout.columns || 80, height: stdout.rows || 24 });

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: stdout.columns || 80, height: stdout.rows || 24 });
    };

    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.removeListener('resize', handleResize);
    };
  }, [stdout]);

  return size;
}
