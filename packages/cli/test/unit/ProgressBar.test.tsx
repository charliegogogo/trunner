import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ProgressBar } from '../../src/ui/ProgressBar.js';

describe('ProgressBar', () => {
  it('renders 0% at value=0', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 0 }));
    expect(lastFrame()).toContain('0%');
  });

  it('renders 100% at value=1', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 1 }));
    expect(lastFrame()).toContain('100%');
  });

  it('renders ~50% at value=0.5', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 0.5 }));
    expect(lastFrame()).toContain('50%');
  });

  it('clamps values above 1', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 2 }));
    expect(lastFrame()).toContain('100%');
  });

  it('clamps values below 0', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: -0.5 }));
    expect(lastFrame()).toContain('0%');
  });

  it('shows the label when provided', () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 0.3, label: 'init' }));
    expect(lastFrame()).toContain('init');
  });
});
