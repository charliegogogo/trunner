import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../src/ui/StatusBar.js';
import type { WorkspaceDisplay } from '../../src/hooks/useWorkspaces.js';
import type { TrunnerRc } from '@trunner/sdk';

function mkRc(tool: 'terraform' | 'opentofu' = 'terraform'): TrunnerRc {
  return { path: '/tmp/ws/.trunnerrc', tool };
}

function mkWs(overrides: Partial<WorkspaceDisplay> & { dir: string }): WorkspaceDisplay {
  return {
    dir: overrides.dir,
    config: overrides.config ?? mkRc(),
    state: overrides.state ?? 'running',
    toolId: overrides.toolId ?? 'terraform',
    version: overrides.version ?? '1.6.6',
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    progress: overrides.progress ?? null,
    progressPercent: overrides.progressPercent ?? 0.5,
    progressLabel: overrides.progressLabel ?? 'plan 50%',
    prompt: overrides.prompt ?? null,
    exitCode: overrides.exitCode ?? null,
    exitSignal: overrides.exitSignal ?? null,
    startedAt: overrides.startedAt ?? Date.now() - 5000,
    endedAt: overrides.endedAt ?? null,
  };
}

describe('StatusBar', () => {
  it('renders the workspace count in the header', () => {
    const ws = [mkWs({ dir: '/tmp/a' }), mkWs({ dir: '/tmp/b' })];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 0 }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/trunner/);
    expect(frame).toMatch(/2 workspaces/);
  });

  it('renders a singular workspace count', () => {
    const ws = [mkWs({ dir: '/tmp/a' })];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 0 }),
    );
    expect(lastFrame()).toMatch(/1 workspace(?!s)/);
  });

  it('renders the discovering placeholder when no workspaces are present', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: [], focusedIndex: 0 }),
    );
    expect(lastFrame()).toMatch(/discovering/);
  });

  it('shows done / failed states with the right colors and exit codes', () => {
    const ws = [
      mkWs({ dir: '/tmp/a', state: 'exited', exitCode: 0 }),
      mkWs({ dir: '/tmp/b', state: 'exited', exitCode: 2 }),
    ];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 0 }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/done/);
    expect(frame).toMatch(/failed \(exit 2\)/);
  });

  it('shows the resolving state with the tool and version', () => {
    const ws = [mkWs({ dir: '/tmp/a', state: 'resolving', toolId: 'opentofu', version: '1.7.0' })];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 0 }),
    );
    expect(lastFrame()).toMatch(/resolving \(opentofu 1\.7\.0\)/);
  });

  it('marks the focused workspace with a leading arrow', () => {
    const ws = [mkWs({ dir: '/tmp/a' }), mkWs({ dir: '/tmp/b' })];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 1 }),
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const aLine = lines.find((l) => l.includes('/tmp/a')) ?? '';
    const bLine = lines.find((l) => l.includes('/tmp/b')) ?? '';
    expect(aLine).not.toMatch(/▶/); // not focused
    expect(bLine).toMatch(/▶/); // focused
  });

  it('reports elapsed time using the startedAt / endedAt fields', () => {
    const now = Date.now();
    const ws = [
      mkWs({ dir: '/tmp/a', startedAt: now - 5000, endedAt: now }),
    ];
    const { lastFrame } = render(
      React.createElement(StatusBar, { workspaces: ws, focusedIndex: 0 }),
    );
    expect(lastFrame()).toMatch(/5s/);
  });
});
