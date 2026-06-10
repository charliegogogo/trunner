import React, { useState, useCallback, useEffect } from 'react';
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
  detectedTool: 'terraform' | 'opentofu' | 'mixed' | null;
}

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

export function InteractiveWizard({ onComplete, defaultRc, detectedTool }: InteractiveWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>('tool');
  const [selectedTool, setSelectedTool] = useState<string>('terraform');
  const [selectedIndex, setSelectedIndex] = useState<number>(
    defaultRc?.command
      ? Math.max(0, ALL_OPTIONS.findIndex((o) => o.command === defaultRc.command))
      : 0
  );
  const [toolIndex, setToolIndex] = useState<number>(0);

  const selectedOption = ALL_OPTIONS[selectedIndex]!;

  // Sync toolIndex/selectedTool when defaultRc loads asynchronously
  useEffect(() => {
    if (step !== 'tool') return;

    // Priority: defaultRc > detectedTool
    if (defaultRc?.tool) {
      const tools = getToolOptions(detectedTool);
      const idx = tools.indexOf(defaultRc.tool);
      if (idx >= 0) {
        setToolIndex(idx);
        setSelectedTool(defaultRc.tool);
      }
    } else if (detectedTool && detectedTool !== 'mixed') {
      setToolIndex(0);
      setSelectedTool(detectedTool);
    } else if (detectedTool === 'mixed') {
      const tools = getToolOptions(detectedTool);
      const idx = tools.indexOf('mixed');
      if (idx >= 0) {
        setToolIndex(idx);
        setSelectedTool('mixed');
      }
    }
  }, [defaultRc?.tool, detectedTool, step]);

  const handleInput = useCallback(
    (input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean }) => {
      const tools = getToolOptions(detectedTool);

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
          setSelectedTool(tools[newIndex]!);
        } else if (key.downArrow) {
          const newIndex = Math.min(tools.length - 1, toolIndex + 1);
          setToolIndex(newIndex);
          setSelectedTool(tools[newIndex]!);
        }
      } else if (step === 'command') {
        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(ALL_OPTIONS.length - 1, prev + 1));
        }
      }
    },
    [step, toolIndex, selectedOption, selectedTool, onComplete, detectedTool],
  );

  useInput(handleInput, { isActive: true });

  const tools = getToolOptions(detectedTool);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner />

      {step === 'tool' && (
        <Box flexDirection="column">
          <Text bold>Select tool:</Text>
          {tools.map((tool, i) => (
            <Text key={tool}>
              {i === toolIndex ? <Text color="green">▶ </Text> : <Text>  </Text>}
              {i === toolIndex ? <Text bold>{tool}</Text> : <Text dimColor>{tool}</Text>}
              {i === toolIndex && tool === selectedTool && defaultRc?.tool === tool && (
                <Text dimColor> (default from .trunnerrc)</Text>
              )}
              {i === toolIndex && tool === 'mixed' && detectedTool === 'mixed' && (
                <Text dimColor> (multiple tools detected)</Text>
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

function getToolOptions(detectedTool: 'terraform' | 'opentofu' | 'mixed' | null): readonly string[] {
  if (detectedTool === 'mixed') {
    return ['terraform', 'opentofu', 'mixed'] as const;
  }
  return ['terraform', 'opentofu'] as const;
}
