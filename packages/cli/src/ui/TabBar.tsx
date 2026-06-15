import React, { useMemo, useState, useEffect, useRef } from 'react';
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

const PREFIX = 'trunner │ ';
const PREFIX_LEN = PREFIX.length;
const SEPARATOR = ' │ ';
const SEPARATOR_LEN = SEPARATOR.length;
const PADDING_X = 2;

/**
 * Calculate the display width of a single tab item (icon + label).
 */
function tabWidth(tab: TabItem): number {
  const iconWidth = tab.icon ? tab.icon.length + 1 : 0;
  return iconWidth + tab.label.length;
}

/**
 * Estimate the display width of the suffix node.
 */
function suffixWidthEstimate(hasSuffix: boolean): number {
  if (!hasSuffix) return 0;
  return 25;
}

/**
 * Calculate how many tabs fit starting from `start` index.
 * Returns [endIndex, totalWidth] where end is exclusive.
 */
function tabsThatFit(
  tabs: TabItem[],
  start: number,
  availableWidth: number,
): [number, number] {
  let width = 0;
  let end = start;
  for (let i = start; i < tabs.length; i++) {
    const w = tabWidth(tabs[i]!);
    const sep = i > start ? SEPARATOR_LEN : 0;
    if (width + sep + w > availableWidth) break;
    width += sep + w;
    end = i + 1;
  }
  return [end, width];
}

/**
 * Common tab bar component with opencode-style tabs.
 * Active tab has purple background, inactive tabs are dimmed.
 * Wrapped in a purple border.
 * Tabs scroll only when the active tab reaches the visible boundary.
 */
export function TabBar({ tabs, activeIndex, suffix, width }: TabBarProps): React.ReactElement {
  const scrollStartRef = useRef(0);
  const prevActiveRef = useRef(activeIndex);
  const [scrollStart, setScrollStart] = useState(0);

  const availableForTabs = width - PADDING_X - PREFIX_LEN - suffixWidthEstimate(!!suffix);

  // Compute the visible window from scrollStart
  const [windowEnd] = useMemo(() => {
    if (availableForTabs <= 0 || tabs.length === 0) return [0];
    return tabsThatFit(tabs, scrollStart, availableForTabs);
  }, [tabs, scrollStart, availableForTabs]);

  // Only shift scrollStart when activeIndex moves past the visible boundary
  useEffect(() => {
    if (tabs.length === 0 || availableForTabs <= 0) return;

    const prev = prevActiveRef.current;
    prevActiveRef.current = activeIndex;

    // Don't shift if nothing changed or on initial render
    if (prev === activeIndex) return;

    const [end] = tabsThatFit(tabs, scrollStartRef.current, availableForTabs);
    const start = scrollStartRef.current;

    let newStart = scrollStartRef.current;

    if (activeIndex >= end) {
      // Active moved past right boundary — shift right until active is visible
      // Recompute from a new start so that activeIndex is the last visible tab
      let candidateStart = activeIndex;
      while (candidateStart > 0) {
        const [e] = tabsThatFit(tabs, candidateStart, availableForTabs);
        if (e > activeIndex) {
          // activeIndex is visible, check if we can shift left more
          candidateStart--;
        } else {
          break;
        }
      }
      // Find the leftmost start where activeIndex is still visible
      let bestStart = activeIndex;
      for (let s = activeIndex; s >= 0; s--) {
        const [e] = tabsThatFit(tabs, s, availableForTabs);
        if (e > activeIndex) {
          bestStart = s;
        } else {
          break;
        }
      }
      newStart = bestStart;
    } else if (activeIndex < start) {
      // Active moved past left boundary — shift left
      newStart = activeIndex;
    }

    if (newStart !== scrollStartRef.current) {
      scrollStartRef.current = newStart;
      setScrollStart(newStart);
    }
  }, [activeIndex, tabs, availableForTabs]);

  // Build visible tabs
  const visibleTabs = useMemo(() => {
    if (availableForTabs <= 0 || tabs.length === 0) return [];
    const [end] = tabsThatFit(tabs, scrollStart, availableForTabs);
    return tabs.slice(scrollStart, end).map((tab, i) => ({
      ...tab,
      originalIndex: scrollStart + i,
    }));
  }, [tabs, scrollStart, availableForTabs]);

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
      {visibleTabs.map((tab, i) => {
        const isActive = tab.originalIndex === activeIndex;
        return (
          <Text key={tab.originalIndex}>
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
