import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ModalOption {
  label: string;
  variant?: 'default' | 'danger' | 'success';
}

export interface ModalProps {
  title: string;
  options: ModalOption[];
  onSelect: (index: number) => void;
  onCancel: () => void;
}

export function Modal({ title, options, onSelect, onCancel }: ModalProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleInput = useCallback(
    (_input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean; escape: boolean }) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        onSelect(selectedIndex);
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(options.length - 1, prev + 1));
      }
    },
    [selectedIndex, options.length, onSelect, onCancel],
  );

  useInput(handleInput, { isActive: true });

  const getOptionColor = (variant: string | undefined, isActive: boolean): string => {
    if (!isActive) return '';
    switch (variant) {
      case 'danger': return 'red';
      case 'success': return 'green';
      default: return 'green';
    }
  };

  return (
    <Box flexDirection="column" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        paddingY={1}
        width={40}
      >
        <Text bold color="magenta">{title}</Text>
        <Box marginTop={1} flexDirection="column">
          {options.map((opt, i) => {
            const isActive = i === selectedIndex;
            const color = getOptionColor(opt.variant, isActive);
            return (
              <Text key={opt.label}>
                {isActive ? <Text color={color}>▶ </Text> : <Text>  </Text>}
                {isActive ? <Text bold color={color}>{opt.label}</Text> : <Text dimColor>{opt.label}</Text>}
              </Text>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑/↓ navigate │ Enter select │ Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
