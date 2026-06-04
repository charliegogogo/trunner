import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { WorkspaceDisplay } from '../hooks/useWorkspaces.js';
import { ProgressBar } from './ProgressBar.js';
import { Spinner } from './Spinner.js';
import { OutputView } from './OutputView.js';
import { Confirm } from './Confirm.js';

export interface WorkspacePaneProps {
  workspace: WorkspaceDisplay;
  command: string;
  commandArgs: readonly string[];
  autoApprove: boolean;
  color: boolean;
  isFocused: boolean;
  onPromptAnswer: (value: string) => void;
  onTab: () => void;
}

export function WorkspacePane({
  workspace,
  command,
  commandArgs,
  autoApprove,
  isFocused,
  onPromptAnswer,
  onTab,
}: WorkspacePaneProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!isFocused) return;
      if (key.tab || input === 'q') {
        onTab();
      }
    },
    { isActive: isFocused },
  );

  useEffect(() => {
    // intentionally empty — useInput is registered above; this effect just
    // keeps the dep tracking explicit when isFocused changes.
  }, [isFocused]);

  const toolLabel = workspace.toolId
    ? `${workspace.toolId}${workspace.version ? ` ${workspace.version}` : ''}`
    : '?';
  const argsLabel = commandArgs.length > 0 ? ` ${commandArgs.join(' ')}` : '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isFocused ? 'green' : 'gray'} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>{workspace.dir}</Text>
        <Text> · {toolLabel} {command}{argsLabel}</Text>
      </Box>
      {workspace.state === 'resolving' ? (
        <Spinner label={`resolving ${toolLabel}`} />
      ) : workspace.state === 'running' ? (
        <ProgressBar value={workspace.progressPercent} label={workspace.progressLabel} />
      ) : null}
      <OutputView stdout={workspace.stdout} stderr={workspace.stderr} maxLines={30} />
      {workspace.prompt ? (
        <Confirm
          question={workspace.prompt.req.question}
          defaultValue={workspace.prompt.req.defaultValue === 'yes'}
          autoYes={autoApprove}
          onAnswer={(v) => onPromptAnswer(v ? 'yes' : 'no')}
        />
      ) : null}
      {workspace.state === 'exited' ? (
        <Box marginTop={1}>
          <Text color={workspace.exitCode === 0 ? 'green' : 'red'}>
            {workspace.exitCode === 0
              ? `✔ done in ${formatElapsed(workspace.startedAt, workspace.endedAt)}`
              : `✖ failed (exit ${workspace.exitCode ?? workspace.exitSignal ?? '?'})`}
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
