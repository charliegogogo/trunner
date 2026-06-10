import React, { useRef } from 'react';
import { Box, Text, useBoxMetrics, useInput, type DOMElement } from 'ink';
import type { WorkingDirDisplay } from '../hooks/useWorkingDirs.js';
import { ProgressBar } from './ProgressBar.js';
import { Spinner } from './Spinner.js';
import { OutputView } from './OutputView.js';
import { Confirm } from './Confirm.js';

export interface WorkingDirPaneProps {
  workingDir: WorkingDirDisplay;
  command: string;
  commandArgs: readonly string[];
  autoApprove: boolean;
  color: boolean;
  isFocused: boolean;
  marginTop?: number;
  onPromptAnswer: (value: string) => void;
  onTab: () => void;
}

export function WorkingDirPane({
  workingDir,
  command,
  commandArgs,
  autoApprove,
  color,
  isFocused,
  marginTop,
  onPromptAnswer,
  onTab,
}: WorkingDirPaneProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!isFocused) return;
      if (key.tab || input === 'q') {
        onTab();
      }
    },
    { isActive: isFocused },
  );

  // useBoxMetrics reads the *actual* rendered box width from Yoga's most
  // recent layout pass. It subscribes to Ink's internal layout event
  // (emitted inside ink.tsx:resized right after calculateLayout()), so
  // this hook re-fires at the same point Ink clears the screen and
  // re-renders — no separate stdout 'resize' subscription, no second
  // throttled write that races with log.clear().
  //
  // We pass `contentWidth` (Yoga width minus border + padding) to
  // OutputView so it can truncate over-long stdout lines to a sensible
  // length instead of letting Yoga wrap them into dozens of stacked rows.
  const outerRef = useRef<DOMElement>(null);
  const { width: outerWidth, hasMeasured } = useBoxMetrics(outerRef);
  // 1 left border + 1 right border + 1 left padding + 1 right padding = 4
  // cells of chrome the OutputView's own Box doesn't have to pay for.
  const contentWidth = hasMeasured ? Math.max(0, outerWidth - 4) : 0;

  const toolLabel = workingDir.toolId
    ? `${workingDir.toolId}${workingDir.version ? ` ${workingDir.version}` : ''}`
    : '?';
  const argsLabel = commandArgs.length > 0 ? ` ${commandArgs.join(' ')}` : '';

  return (
    <Box
      ref={outerRef}
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? 'green' : 'gray'}
      paddingX={1}
      width="100%"
      flexShrink={0}
      {...(marginTop !== undefined ? { marginTop } : {})}
    >
      <Box marginBottom={1} width="100%">
        <Text bold wrap="truncate">{workingDir.dir}</Text>
        <Text> · {toolLabel} {command}{argsLabel}</Text>
      </Box>
      {workingDir.state === 'resolving' ? (
        <Spinner label={`resolving ${toolLabel}`} />
      ) : workingDir.state === 'running' ? (
        <ProgressBar value={workingDir.progressPercent} label={workingDir.progressLabel} />
      ) : null}
      <OutputView
        stdout={workingDir.stdout}
        stderr={workingDir.stderr}
        maxLines={30}
        contentWidth={contentWidth}
      />
      {workingDir.prompt ? (
        <Confirm
          question={workingDir.prompt.req.question}
          defaultValue={workingDir.prompt.req.defaultValue === 'yes'}
          autoYes={autoApprove}
          onAnswer={(v) => onPromptAnswer(v ? 'yes' : 'no')}
        />
      ) : null}
      {workingDir.state === 'exited' ? (
        <Box marginTop={1}>
          <Text color={workingDir.exitCode === 0 ? 'green' : 'red'}>
            {workingDir.exitCode === 0
              ? `✔ done in ${formatElapsed(workingDir.startedAt, workingDir.endedAt)}`
              : `✖ failed (exit ${workingDir.exitCode ?? workingDir.exitSignal ?? '?'})`}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function formatElapsed(startedAt: number, endedAt: number | null): string {
  const end = endedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}
