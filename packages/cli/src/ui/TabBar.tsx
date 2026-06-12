import React from 'react';
import { Box, Text } from 'ink';

export interface TabItem {
  label: string;
  icon?: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeIndex: number;
  /** Extra content to show after tabs (e.g., working dir count) */
  suffix?: React.ReactNode;
  /** Width of the tab bar */
  width: number;
}

/**
 * Common tab bar component with opencode-style tabs.
 * Active tab has purple background, inactive tabs are dimmed.
 * Wrapped in a purple border.
 */
export function TabBar({ tabs, activeIndex, suffix, width }: TabBarProps): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      width={width}
    >
      <Text bold color="magenta">trunner</Text>
      <Text dimColor> │ </Text>
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        return (
          <Text key={tab.label}>
            {i > 0 && <Text dimColor> │ </Text>}
            {isActive ? (
              <Text bold backgroundColor="magenta" color="white">
                {tab.icon && `${tab.icon} `}{tab.label}
              </Text>
            ) : (
              <Text dimColor>
                {tab.icon && `${tab.icon} `}{tab.label}
              </Text>
            )}
          </Text>
        );
      })}
      {suffix && (
        <>
          <Text dimColor> │ </Text>
          {suffix}
        </>
      )}
    </Box>
  );
}
