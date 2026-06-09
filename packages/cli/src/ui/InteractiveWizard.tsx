import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TrunnerRc } from '@trunner/sdk';

export interface InteractiveWizardProps {
  onComplete: (result: { command: string; tool: string }) => void;
  defaultRc: TrunnerRc | null;
}

const COMMANDS = ['plan', 'apply', 'destroy', 'tools', 'providers'] as const;
const TOOLS = ['terraform', 'opentofu'] as const;

type Step = 'command' | 'tool' | 'done';

export function InteractiveWizard({ onComplete, defaultRc }: InteractiveWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>('command');
  const [selectedCommand, setSelectedCommand] = useState<string>(
    defaultRc?.command && COMMANDS.includes(defaultRc.command as any) ? defaultRc.command : COMMANDS[0]
  );
  const [selectedTool, setSelectedTool] = useState<string>(
    defaultRc?.tool && TOOLS.includes(defaultRc.tool) ? defaultRc.tool : TOOLS[0]
  );
  const [commandIndex, setCommandIndex] = useState<number>(
    defaultRc?.command && COMMANDS.includes(defaultRc.command as any) ? COMMANDS.indexOf(defaultRc.command as any) : 0
  );
  const [toolIndex, setToolIndex] = useState<number>(
    defaultRc?.tool && TOOLS.includes(defaultRc.tool) ? TOOLS.indexOf(defaultRc.tool) : 0
  );

  useEffect(() => {
    if (step === 'done') {
      onComplete({ command: selectedCommand, tool: selectedTool });
    }
  }, [step, selectedCommand, selectedTool, onComplete]);

  const handleInput = useCallback(
    (input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean }) => {
      if (key.return) {
        if (step === 'command') {
          setStep('tool');
        } else if (step === 'tool') {
          setStep('done');
        }
        return;
      }
      if (step === 'command') {
        if (key.upArrow) {
          const newIndex = Math.max(0, commandIndex - 1);
          setCommandIndex(newIndex);
          setSelectedCommand(COMMANDS[newIndex]!);
        } else if (key.downArrow) {
          const newIndex = Math.min(COMMANDS.length - 1, commandIndex + 1);
          setCommandIndex(newIndex);
          setSelectedCommand(COMMANDS[newIndex]!);
        }
      } else if (step === 'tool') {
        if (key.upArrow) {
          const newIndex = Math.max(0, toolIndex - 1);
          setToolIndex(newIndex);
          setSelectedTool(TOOLS[newIndex]!);
        } else if (key.downArrow) {
          const newIndex = Math.min(TOOLS.length - 1, toolIndex + 1);
          setToolIndex(newIndex);
          setSelectedTool(TOOLS[newIndex]!);
        }
      }
    },
    [step, commandIndex, toolIndex],
  );

  useInput(handleInput, { isActive: true });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>trunner</Text>
        <Text dimColor> · interactive mode</Text>
      </Box>

      {step === 'command' && (
        <Box flexDirection="column">
          <Text>Select command:</Text>
          {COMMANDS.map((cmd, i) => (
            <Text key={cmd}>
              {i === commandIndex ? <Text color="green">▶ </Text> : <Text>  </Text>}
              {i === commandIndex ? <Text bold>{cmd}</Text> : <Text dimColor>{cmd}</Text>}
              {i === commandIndex && cmd === selectedCommand && defaultRc?.command === cmd && (
                <Text dimColor> (default from .trunnerrc)</Text>
              )}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Enter</Text> to select, <Text bold>↑/↓</Text> to navigate</Text>
          </Box>
        </Box>
      )}

      {step === 'tool' && (
        <Box flexDirection="column">
          <Text>Select tool:</Text>
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
            <Text dimColor>Press <Text bold>Enter</Text> to confirm, <Text bold>↑/↓</Text> or <Text bold>j/k</Text> to navigate</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}