import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmProps {
  question: string;
  defaultValue?: boolean;
  autoYes?: boolean;
  onAnswer: (value: boolean) => void;
}

export function Confirm({ question, defaultValue = false, autoYes = false, onAnswer }: ConfirmProps): React.ReactElement {
  const [value, setValue] = useState<boolean | null>(null);

  useEffect(() => {
    if (autoYes) {
      setValue(true);
      onAnswer(true);
    }
  }, [autoYes, onAnswer]);

  useInput((input, key) => {
    if (value !== null) return;
    if (input === 'y' || input === 'Y') {
      setValue(true);
      onAnswer(true);
    } else if (input === 'n' || input === 'N') {
      setValue(false);
      onAnswer(false);
    } else if (key.return) {
      setValue(defaultValue);
      onAnswer(defaultValue);
    }
  });

  return (
    <Box>
      <Text color="yellow">? </Text>
      <Text>{question} </Text>
      <Text dimColor>[y/N]</Text>
      {value === true ? <Text color="green"> yes</Text> : null}
      {value === false ? <Text color="red"> no</Text> : null}
    </Box>
  );
}
