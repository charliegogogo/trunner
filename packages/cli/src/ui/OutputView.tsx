import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface OutputViewProps {
  stdout: string;
  stderr: string;
  maxLines?: number;
  contentWidth?: number;
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

function truncateLine(line: string, max: number): string {
  if (max <= 0) return '';
  // Use code-point count, not UTF-16 .length, so a CJK character counts
  // as one column rather than two (surrogate pairs). We don't pull in
  // string-width as a direct dep just for this — the worst case is we
  // over-trim a wide-char line by one column, which is invisible to users.
  const len = Array.from(line).length;
  if (len <= max) return line;
  if (max <= 1) return '…';
  return Array.from(line).slice(0, max - 1).join('') + '…';
}

export function OutputView({ stdout, stderr, maxLines = 50, contentWidth = 0 }: OutputViewProps): React.ReactElement {
  const out = useMemo(() => stripAnsi(clip(stdout, maxLines)), [stdout, maxLines]);
  const err = useMemo(() => stripAnsi(clip(stderr, Math.max(10, Math.floor(maxLines / 3)))), [stderr, maxLines]);
  // Truncate each rendered line to `contentWidth` columns so a single
  // 300-char terraform warning doesn't fold into a dozen wrapped rows and
  // push the entire pane's layout out. Yoga would still wrap to a smaller
  // box width, so this is a ceiling, not a floor. `contentWidth === 0`
  // means we haven't measured yet (first render) — leave lines alone.
  const renderedOut = useMemo(
    () => (contentWidth > 0 ? out.split('\n').map((l) => truncateLine(l, contentWidth)).join('\n') : out),
    [out, contentWidth],
  );
  const renderedErr = useMemo(
    () => (contentWidth > 0 ? err.split('\n').map((l) => truncateLine(l, contentWidth)).join('\n') : err),
    [err, contentWidth],
  );

  if (!out && !err) {
    return (
      <Box marginY={1}>
        <Text dimColor>(no output yet)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {renderedOut ? (
        <Box flexDirection="column">
          {renderedOut.split('\n').map((line, i) => (
            <Text key={`o-${i}`}>{line}</Text>
          ))}
        </Box>
      ) : null}
      {renderedErr ? (
        <Box flexDirection="column" marginTop={1}>
          {renderedErr.split('\n').map((line, i) => (
            <Text key={`e-${i}`} color="red">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
