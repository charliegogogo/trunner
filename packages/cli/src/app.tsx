import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from './ui/Spinner.js';
import { ProgressBar } from './ui/ProgressBar.js';
import { Confirm } from './ui/Confirm.js';
import { OutputView } from './ui/OutputView.js';
import { useRunner } from './hooks/useRunner.js';
import { createMockRunner, type MockRunner } from './mock/mock-runner.js';
import type { RunnerHandle, ToolId } from '@trunner/sdk';

export interface AppFlags {
  mock: boolean;
  cwd: string;
  autoYes: boolean;
  color: boolean;
}

export interface AppProps {
  tool?: string;
  command?: string;
  commandArgs: string[];
  flags: AppFlags;
}

const SUPPORTED_TOOLS: Record<string, ToolId> = {
  terraform: 'terraform',
  tofu: 'opentofu',
  opentofu: 'opentofu',
  terragrunt: 'terragrunt',
};

type Built = { ok: true; binary: string; args: string[]; cwd: string } | { ok: false; error: string };

function buildMockInvocation(
  toolName: string,
  commandName: string,
  commandArgs: string[],
  flags: AppFlags,
): Built {
  if (!commandName) {
    return { ok: false, error: 'No command provided. Try: trunner terraform plan' };
  }
  return {
    ok: true,
    binary: 'mock',
    args: [SUPPORTED_TOOLS[toolName] ?? 'terraform', commandName, ...commandArgs],
    cwd: flags.cwd,
  };
}

async function buildRealInvocation(
  toolName: string,
  commandName: string,
  commandArgs: string[],
  flags: AppFlags,
): Promise<Built> {
  const sdk = await import('@trunner/sdk');
  const toolId = SUPPORTED_TOOLS[toolName];
  if (!toolId) {
    return {
      ok: false,
      error: `Unknown tool: ${toolName} (supported: ${Object.keys(SUPPORTED_TOOLS).join(', ')})`,
    };
  }
  if (!commandName) {
    return { ok: false, error: 'No command provided. Try: trunner terraform plan' };
  }
  let registry = sdk.getDefaultRegistry();
  if (registry.list().length === 0) {
    sdk.registerBuiltinTools(registry);
  }
  const tool = registry.get(toolId);
  if (!tool) {
    return {
      ok: false,
      error: `Tool "${toolId}" is not registered. Only "terraform" is implemented in Phase 2A.`,
    };
  }
  const spec = tool.commands.get(commandName);
  if (!spec) {
    const available = tool.commands.list().map((c) => c.name).join(', ');
    return { ok: false, error: `Unknown command "${commandName}" for ${toolName}. Available: ${available}` };
  }
  const invocation = tool.commands.buildInvocation(commandName, {
    cwd: flags.cwd,
    extraArgs: commandArgs,
    autoApprove: flags.autoYes,
  });
  const binary = tool.binary.binaryPath('latest');
  return { ok: true, binary, args: invocation, cwd: flags.cwd };
}

export function App({ tool, command, commandArgs, flags }: AppProps): React.ReactElement {
  const [built, setBuilt] = useState<Built | null>(null);
  const [runner, setRunner] = useState<RunnerHandle | MockRunner | null>(null);
  const state = useRunner(runner);

  useEffect(() => {
    if (!tool) {
      setBuilt(null);
      return;
    }
    let cancelled = false;
    if (flags.mock) {
      const result = buildMockInvocation(tool, command ?? '', commandArgs, flags);
      if (!cancelled) setBuilt(result);
    } else {
      void buildRealInvocation(tool, command ?? '', commandArgs, flags).then((result) => {
        if (!cancelled) setBuilt(result);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [tool, command, commandArgs, flags]);

  useEffect(() => {
    if (!built || !built.ok) {
      setRunner(null);
      return;
    }
    if (flags.mock) {
      setRunner(createMockRunner({ tool: built.args[0] ?? 'terraform', command: built.args[1] ?? 'plan' }));
    } else {
      void import('@trunner/sdk').then((sdk) => {
        setRunner(sdk.createRunner({}));
      });
    }
    return () => {
      setRunner(null);
    };
  }, [built, flags.mock]);

  useEffect(() => {
    if (!runner || !built || !built.ok) return;
    if (flags.mock) {
      void (runner as MockRunner).start();
    } else {
      void (runner as RunnerHandle).run({
        binaryPath: built.binary,
        args: built.args,
        cwd: built.cwd,
      });
    }
  }, [runner, built, flags.mock]);

  if (!tool) {
    return (
      <Box flexDirection="column">
        <Text>trunner: missing tool name. Try `trunner terraform plan`.</Text>
      </Box>
    );
  }
  if (built && !built.ok) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {built.error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>trunner</Text>
        <Text> · {tool} {command ?? ''}</Text>
        {flags.mock ? <Text color="yellow"> · mock mode</Text> : null}
      </Box>
      <ProgressBar value={state.progressPercent} label={state.progressLabel} />
      {state.status === 'running' ? <Spinner label={state.statusLabel} /> : null}
      <OutputView stdout={state.stdout} stderr={state.stderr} />
      {state.prompt ? (
        <Confirm
          question={state.prompt.question}
          defaultValue={state.prompt.defaultValue === 'yes'}
          autoYes={flags.autoYes}
          onAnswer={(value) => state.answerPrompt?.(value ? 'yes' : 'no')}
        />
      ) : null}
      {state.status === 'exited' ? (
        <Box marginTop={1}>
          <Text color={state.exitCode === 0 ? 'green' : 'red'}>
            {state.exitCode === 0 ? '✔ done' : `✖ failed (exit ${state.exitCode ?? state.exitSignal ?? '?'})`}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
