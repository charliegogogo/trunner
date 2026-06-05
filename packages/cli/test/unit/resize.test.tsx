import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../src/ui/StatusBar.js';
import type { WorkspaceDisplay } from '../../src/hooks/useWorkspaces.js';

function makeWs(dir: string): WorkspaceDisplay {
  return {
    dir,
    config: { path: `${dir}/.trunnerrc`, tool: 'terraform' },
    state: 'pending',
    toolId: 'terraform',
    version: '1.6.6',
    stdout: '',
    stderr: '',
    progress: null,
    progressPercent: 0,
    progressLabel: '',
    prompt: null,
    exitCode: null,
    exitSignal: null,
    startedAt: Date.now(),
    endedAt: null,
  };
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (predicate() || Date.now() >= deadline) return resolve();
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('StatusBar terminal-width layout', () => {
  // ink-testing-library's Stdout stub always reports columns=100. We rely
  // on Ink's own useWindowSize hook to listen for 'resize' and re-render.
  // The assertion below verifies the rendered border line uses that width.
  it('outer border spans the current terminal width', async () => {
    const inst = render(
      React.createElement(StatusBar, {
        workspaces: [makeWs('/tmp/a'), makeWs('/tmp/b')],
        focusedIndex: 0,
      }),
    );
    await waitFor(() => (inst.lastFrame() ?? '').includes('trunner'));
    const lines = (inst.lastFrame() ?? '').split('\n');
    // Find the top border line (rounded-corner char + row of "─").
    const topBorder = lines.find((l) => /[┌╭]/.test(l) || /^─+/.test(l));
    expect(topBorder).toBeDefined();
    const stripped = (topBorder ?? '').replace(/\u001b\[[0-9;]*m/g, '');
    // The mock Stdout reports columns=100, so the border line should be
    // ~100 chars wide. Allow ±2 for ink's own width math.
    expect(stripped.length).toBeGreaterThanOrEqual(98);
    expect(stripped.length).toBeLessThanOrEqual(102);
  });
});
