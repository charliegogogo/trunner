import React, { useMemo } from 'react';

export interface ScrollableListProps<T> {
  items: T[];
  selectedIndex: number;
  maxVisible: number;
  renderItem: (item: T, index: number, isActive: boolean) => React.ReactElement;
}

/**
 * A generic scrollable list component.
 * Automatically scrolls to keep the selected item visible.
 * Only shifts the window when the selection moves past the boundary.
 */
export function ScrollableList<T>({ items, selectedIndex, maxVisible, renderItem }: ScrollableListProps<T>): React.ReactElement {
  const scrollStart = useMemo(() => {
    if (items.length <= maxVisible) return 0;
    return Math.max(0, Math.min(
      selectedIndex - Math.floor(maxVisible / 2),
      items.length - maxVisible,
    ));
  }, [items.length, selectedIndex, maxVisible]);

  const visibleItems = useMemo(() => {
    const start = scrollStart;
    const end = Math.min(start + maxVisible, items.length);
    return items.slice(start, end).map((item, i) => ({
      item,
      originalIndex: start + i,
    }));
  }, [items, scrollStart, maxVisible]);

  return (
    <>
      {visibleItems.map(({ item, originalIndex }) => (
        renderItem(item, originalIndex, originalIndex === selectedIndex)
      ))}
    </>
  );
}
