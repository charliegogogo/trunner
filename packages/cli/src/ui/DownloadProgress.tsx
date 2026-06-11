import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

export interface DownloadProgressProps {
  /** Current bytes downloaded */
  current: number;
  /** Total bytes (may be 0 if unknown) */
  total: number;
  /** Phase label (e.g., "Downloading terraform 1.6.6") */
  label?: string;
  /** Available width for the progress bar */
  width?: number;
}

interface SpeedSample {
  bytes: number;
  timestamp: number;
}

const SPEED_WINDOW_MS = 3000;
const MIN_SPEED_SAMPLES = 3;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function DownloadProgress({ current, total, label, width = 50 }: DownloadProgressProps): React.ReactElement {
  const [speedSamples, setSpeedSamples] = useState<SpeedSample[]>([]);
  const lastUpdateRef = useRef<{ bytes: number; timestamp: number } | null>(null);

  useEffect(() => {
    const now = Date.now();
    const last = lastUpdateRef.current;

    if (last) {
      const elapsed = now - last.timestamp;
      if (elapsed > 0) {
        const bytesDelta = current - last.bytes;
        setSpeedSamples((prev) => {
          const newSamples = [...prev, { bytes: bytesDelta, timestamp: now }];
          const cutoff = now - SPEED_WINDOW_MS;
          return newSamples.filter((s) => s.timestamp >= cutoff);
        });
      }
    }

    lastUpdateRef.current = { bytes: current, timestamp: now };
  }, [current]);

  // Calculate speed from samples
  const speed = React.useMemo(() => {
    if (speedSamples.length < MIN_SPEED_SAMPLES) return 0;
    const totalBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0);
    const timeSpan = (speedSamples[speedSamples.length - 1]!.timestamp - speedSamples[0]!.timestamp) / 1000;
    if (timeSpan <= 0) return 0;
    return totalBytes / timeSpan;
  }, [speedSamples]);

  const percentage = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
  const hasTotal = total > 0 && total !== current;

  // Calculate text width: "100% 999.9 MB / 999.9 MB (999.9 MB/s)" ~ 40 chars
  const textWidth = 40;
  const barWidth = Math.max(10, Math.min(width - textWidth, 60));
  const filledWidth = hasTotal ? Math.round((percentage / 100) * barWidth) : 0;
  const emptyWidth = barWidth - filledWidth;

  const bar = (
    <Text>
      <Text color="green">{'█'.repeat(filledWidth)}</Text>
      <Text dimColor>{'░'.repeat(emptyWidth)}</Text>
    </Text>
  );

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={0}>
          <Text color="cyan">{label}</Text>
        </Box>
      )}
      <Box>
        {bar}
        <Text> </Text>
        {hasTotal ? (
          <Text bold>{percentage}%</Text>
        ) : (
          <Text dimColor>...</Text>
        )}
        <Text> </Text>
        <Text dimColor>{formatBytes(current)}</Text>
        {hasTotal && <Text dimColor> / {formatBytes(total)}</Text>}
        {speed > 0 && (
          <Text dimColor> ({formatSpeed(speed)})</Text>
        )}
      </Box>
    </Box>
  );
}
