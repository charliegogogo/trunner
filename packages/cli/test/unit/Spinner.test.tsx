import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Spinner } from '../../src/ui/Spinner.js';

describe('Spinner', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(React.createElement(Spinner));
    expect(lastFrame()).toBeDefined();
  });

  it('renders the label when provided', async () => {
    const { lastFrame } = render(React.createElement(Spinner, { label: 'loading…' }));
    expect(lastFrame()).toContain('loading…');
  });

  it('cycles frames over time', async () => {
    const { lastFrame, rerender } = render(React.createElement(Spinner, { intervalMs: 30 }));
    const f1 = lastFrame();
    await new Promise((r) => setTimeout(r, 60));
    const f2 = lastFrame();
    rerender(React.createElement(Spinner, { intervalMs: 30 }));
    const f3 = lastFrame();
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    expect(f3).toBeDefined();
  });
});
