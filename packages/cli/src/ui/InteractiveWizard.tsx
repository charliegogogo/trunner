import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TrunnerRc } from '@trunner/sdk';
import { Banner } from './Banner.js';

export interface InteractiveWizardResult {
  command: string;
  tool: string;
  category: 'run' | 'manage';
  managementTarget?: 'tools' | 'providers';
}

export interface InteractiveWizardProps {
  onComplete: (result: InteractiveWizardResult) => void;
  defaultRc: TrunnerRc | null;
}

const TOOLS = ['terraform', 'opentofu'] as const;
const RUN_COMMANDS = ['plan', 'apply', 'destroy'] as const;
const MANAGE_OPTIONS = ['tools', 'providers'] as const;

// Combined selectable items with their indices
const ALL_OPTIONS = [
  ...RUN_COMMANDS.map((cmd) => ({ command: cmd, category: 'run' as const })),
  ...MANAGE_OPTIONS.map((opt) => ({
    command: opt,
    category: 'manage' as const,
    managementTarget: opt as 'tools' | 'providers',
  })),
];

type Step = 'tool' | 'command';

export function InteractiveWizard({ onComplete, defaultRc }: InteractiveWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>('tool');
  const [selectedTool, setSelectedTool] = useState<string>(
    defaultRc?.tool && TOOLS.includes(defaultRc.tool as any) ? defaultRc.tool : TOOLS[0]
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(
    defaultRc?.command
      ? Math.max(0, ALL_OPTIONS.findIndex((o) => o.command === defaultRc.command))
      : 0
  );

  const [toolIndex, setToolIndex] = useState<number>(
    defaultRc?.tool && TOOLS.includes(defaultRc.tool) ? TOOLS.indexOf(defaultRc.tool as any) : 0
  );

  const selectedOption = ALL_OPTIONS[selectedIndex]!;

  const handleInput = useCallback(
    (input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean }) => {
      if (key.return) {
        if (step === 'tool') {
          setStep('command');
        } else if (step === 'command') {
          // User confirmed command selection
          const result: InteractiveWizardResult = {
            command: selectedOption.command,
            tool: selectedTool,
            category: selectedOption.category,
          };
          if ('managementTarget' in selectedOption) {
            result.managementTarget = selectedOption.managementTarget;
          }
          onComplete(result);
        }
        return;
      }

      if (step === 'tool') {
        if (key.upArrow) {
          const newIndex = Math.max(0, toolIndex - 1);
          setToolIndex(newIndex);
          setSelectedTool(TOOLS[newIndex]!);
        } else if (key.downArrow) {
          const newIndex = Math.min(TOOLS.length - 1, toolIndex + 1);
          setToolIndex(newIndex);
          setSelectedTool(TOOLS[newIndex]!);
        }
      } else if (step === 'command') {
        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(ALL_OPTIONS.length - 1, prev + 1));
        }
      }
    },
    [step, toolIndex, selectedOption, selectedTool, onComplete],
  );

  useInput(handleInput, { isActive: true });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner />

      {step === 'tool' && (
        <Box flexDirection="column">
          <Text bold>Select tool:</Text>
          {TOOLS.map((tool, i) => (
            <Text key={tool}>
              {i === toolIndex ? <Text color="green">▶ </Text> : <Text>  </Text>}
              {i === toolIndex ? <Text bold>{tool}</Text> : <Text dimColor>{tool}</Text>}
              {i === toolIndex && tool === selectedTool && defaultRc?.tool === tool && (
                <Text dimColor> (default from .trunnerrc)</Text>
              )}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Enter</Text> to select, <Text bold>↑/↓</Text> to navigate</Text>
          </Box>
        </Box>
      )}

      {step === 'command' && (
        <Box flexDirection="column">
          <Text bold>Select command:</Text>

          {/* Run Commands group */}
          <Box marginTop={1}>
            <Text bold color="magenta">Run Commands:</Text>
          </Box>
          {RUN_COMMANDS.map((cmd) => {
            const idx = ALL_OPTIONS.findIndex((o) => o.command === cmd);
            const isActive = idx === selectedIndex;
            return (
              <Text key={cmd}>
                {isActive ? <Text color="green">▶ </Text> : <Text>  </Text>}
                {isActive ? <Text bold>{cmd}</Text> : <Text dimColor>{cmd}</Text>}
                {isActive && cmd === defaultRc?.command && (
                  <Text dimColor> (default from .trunnerrc)</Text>
                )}
              </Text>
            );
          })}

          {/* Manage Binaries group */}
          <Box marginTop={1}>
            <Text bold color="magenta">Manage Binaries:</Text>
          </Box>
          {MANAGE_OPTIONS.map((opt) => {
            const idx = ALL_OPTIONS.findIndex((o) => o.command === opt);
            const isActive = idx === selectedIndex;
            return (
              <Text key={opt}>
                {isActive ? <Text color="green">▶ </Text> : <Text>  </Text>}
                {isActive ? <Text bold>{opt}</Text> : <Text dimColor>{opt}</Text>}
              </Text>
            );
          })}

          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Enter</Text> to select, <Text bold>↑/↓</Text> to navigate</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
