import React, { useEffect, useRef, useMemo } from 'react';
import { Box } from 'ink';
import { relative } from 'node:path';
import type { WorkingDirDisplay } from '../hooks/useWorkingDirs.js';
import type { RunSummary } from '@trunner/sdk';
import { getWorkingDirAnsiColor } from '../utils/colors.js';

export interface StreamViewProps {
  workingDirs: WorkingDirDisplay[];
  cwd: string;
  command: string | null;
  summary: RunSummary | null;
  isComplete: boolean;
  width: number;
  height: number;
}

function getRelativePath(dir: string, cwd: string): string {
  const rel = relative(cwd, dir);
  return rel || '.';
}

/**
 * StreamView displays real-time output from multiple working directories
 * with colored prefixes for easy visual distinction.
 *
 * Uses process.stdout.write() directly to avoid Ink's cursor movement
 * which causes duplicate output when stdout is not a TTY.
 */
export function StreamView({
  workingDirs,
  cwd,
  command: _command,
  summary: _summary,
  isComplete,
  width,
  height: _height,
}: StreamViewProps): React.ReactElement {
  const total = workingDirs.length;

  // Track byte offset into w.stdout for each working directory — not line count,
  // because a partial line (no trailing \n) can grow when the next chunk
  // arrives, keeping the line-count the same while adding printable content.
  const offsetRef = useRef<Map<string, number>>(new Map());

  // Build a map from dir -> index for consistent color assignment
  const dirIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    workingDirs.forEach((wd, i) => map.set(wd.dir, i));
    return map;
  }, [workingDirs]);

  // Calculate max prefix length to ensure consistent alignment
  const maxPrefixLength = useMemo(() => {
    let max = 0;
    for (const wd of workingDirs) {
      const prefix = getRelativePath(wd.dir, cwd);
      // [prefix] + space = prefix.length + 3
      max = Math.max(max, prefix.length + 3);
    }
    return Math.min(max, Math.floor(width * 0.4)); // Cap at 40% of terminal width
  }, [workingDirs, cwd, width]);

  // Print new output lines directly to stdout
  // NOTE: must NOT early-return when isComplete — React batches the final
  // stdout chunk and the 'done' event into a single render, so the last
  // lines (e.g. terraform Outputs) would be silently dropped.
  useEffect(() => {
    for (const wd of workingDirs) {
      const colorIndex = dirIndexMap.get(wd.dir) ?? 0;
      const prefix = getRelativePath(wd.dir, cwd);

      const offset = offsetRef.current.get(wd.dir) ?? 0;

      // Nothing new to process
      if (wd.stdout.length <= offset) continue;

      const newContent = wd.stdout.slice(offset);

      // Find the last newline — everything before it is complete lines.
      // If there's no newline, the entire content is a partial line;
      // don't print anything yet — wait for the next chunk.
      const lastIdx = newContent.lastIndexOf('\n');
      if (lastIdx === -1) continue;

      // Print all complete lines (everything up to and including the last \n)
      const completeContent = newContent.slice(0, lastIdx + 1);
      const rawLines = completeContent.split(/\r?\n/);

      // split("line\n") produces ["line", ""]
      // split("line1\nline2\n") produces ["line1", "line2", ""]
      // The trailing empty string is never a real line — always remove it.
      if (rawLines[rawLines.length - 1] === '') rawLines.pop();

      for (const rawLine of rawLines) {
        // Handle embedded \r: keep only the last segment after the last \r.
        // This simulates terminal overwrite behavior
        // (e.g. "Progress (1/5)\rProgress (2/5)" → "Progress (2/5)")
        const line = rawLine.includes('\r')
          ? rawLine.split('\r').pop() ?? ''
          : rawLine;

        const color = getWorkingDirAnsiColor(colorIndex, total);
        const paddedPrefix = prefix.padEnd(maxPrefixLength - 3);
        const output = `${color.open}[${paddedPrefix}]${color.close} ${line}\n`;
        process.stdout.write(output);
      }

      // Advance offset to just after the last newline.
      // Any content after the last \n is a partial line — it will be
      // re-included on the next render via slice(offset).
      offsetRef.current.set(wd.dir, offset + lastIdx + 1);
    }
  }, [workingDirs, cwd, dirIndexMap, total, maxPrefixLength]);

  // During streaming, don't render anything via Ink (output goes directly to stdout)
  // After completion, show nothing (summary is handled by onExit callback)
  return <Box />;
}
