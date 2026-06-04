import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { Text } from 'ink';
import { useWorkspaces } from '../../src/hooks/useWorkspaces.js';
import type { TrunnerRc, WorkspaceEvent } from '@trunner/sdk';

afterEach(() => {
  cleanup();
});

const RC: TrunnerRc = { path: '/ws/.trunnerrc', tool: 'terraform' };

async function* makeIter(events: WorkspaceEvent[]): AsyncIterable<WorkspaceEvent> {
  for (const e of events) {
    yield e;
    await new Promise((r) => setImmediate(r));
  }
}

function SnapshotView({
  workspaces,
  summary,
}: {
  workspaces: unknown[];
  summary: { total: number; succeeded: number; failed: number } | null;
}): React.ReactElement {
  return (
    <Text>
      {workspaces.length}:{summary ? `${summary.succeeded}+${summary.failed}/${summary.total}` : 'no-summary'}
    </Text>
  );
}

function Probe({ events }: { events: WorkspaceEvent[] }): React.ReactElement {
  const [iter] = useState(() => makeIter(events));
  const r = useWorkspaces(iter);
  return <SnapshotView workspaces={r.workspaces} summary={r.summary} />;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('useWorkspaces', () => {
  it('returns empty state when iter is null', () => {
    let capturedWorkspaces: unknown[] = [];
    let capturedSummary: unknown = null;
    function NullProbe(): React.ReactElement {
      const r = useWorkspaces(null);
      capturedWorkspaces = r.workspaces;
      capturedSummary = r.summary;
      return <Text>probe</Text>;
    }
    render(React.createElement(NullProbe));
    expect(capturedWorkspaces).toEqual([]);
    expect(capturedSummary).toBeNull();
  });

  it('routes started / stdout / exited events to the right workspace', async () => {
    const events: WorkspaceEvent[] = [
      { kind: 'started', workspace: { dir: '/ws/a', config: RC } },
      { kind: 'resolving', workspace: { dir: '/ws/a', config: RC }, toolId: 'terraform', version: '1.6.6' },
      { kind: 'stdout', workspace: { dir: '/ws/a', config: RC }, chunk: 'hello\n' },
      { kind: 'progress', workspace: { dir: '/ws/a', config: RC }, info: { phase: 'plan', current: 50, total: 100, unit: 'percent' } },
      { kind: 'exited', workspace: { dir: '/ws/a', config: RC }, code: 0, signal: null },
      { kind: 'done', summary: { total: 1, succeeded: 1, failed: 0, workspaces: new Map([['/ws/a', 0]]) } },
    ];
    const inst = render(React.createElement(Probe, { events }));
    // Wait for the DOM frame to reflect the final state. The frame string
    // encodes both the workspace count and the summary line. The 3 s
    // budget comfortably covers 8 events at ink's 30 fps render throttle
    // (≈ 33 ms / event) plus setImmediate handoffs.
    await waitFor(() => inst.lastFrame() === '1:1+0/1', 3000);
    expect(inst.lastFrame()).toBe('1:1+0/1');
  });

  it('routes events from two concurrent workspaces independently', async () => {
    const events: WorkspaceEvent[] = [
      { kind: 'started', workspace: { dir: '/ws/a', config: RC } },
      { kind: 'started', workspace: { dir: '/ws/b', config: RC } },
      { kind: 'stdout', workspace: { dir: '/ws/a', config: RC }, chunk: 'a1' },
      { kind: 'stdout', workspace: { dir: '/ws/b', config: RC }, chunk: 'b1' },
      { kind: 'stdout', workspace: { dir: '/ws/a', config: RC }, chunk: 'a2' },
      { kind: 'exited', workspace: { dir: '/ws/a', config: RC }, code: 0, signal: null },
      { kind: 'exited', workspace: { dir: '/ws/b', config: RC }, code: 1, signal: null },
      { kind: 'done', summary: { total: 2, succeeded: 1, failed: 1, workspaces: new Map([['/ws/a', 0], ['/ws/b', 1]]) } },
    ];
    const inst = render(React.createElement(Probe, { events }));
    await waitFor(() => inst.lastFrame() === '2:1+1/2', 3000);
    expect(inst.lastFrame()).toBe('2:1+1/2');
  });

  it('captures the prompt and routes answerFocusedPrompt to the focused workspace', async () => {
    let capturedAnswer: string | null = null;
    const events: WorkspaceEvent[] = [
      { kind: 'started', workspace: { dir: '/ws/a', config: RC } },
      {
        kind: 'prompt',
        workspace: { dir: '/ws/a', config: RC },
        req: { promptId: 'p1', question: 'Apply?', kind: 'confirm', defaultValue: 'no' },
        answer: (v: string) => { capturedAnswer = v; },
      },
    ];
    let answerFn: ((v: string) => void) | null = null;
    function PromptProbe(): React.ReactElement {
      const [iter] = useState(() => makeIter(events));
      const r = useWorkspaces(iter);
      if (r.workspaces[0]?.prompt && !answerFn) {
        answerFn = r.answerFocusedPrompt;
      }
      return <SnapshotView workspaces={r.workspaces} summary={r.summary} />;
    }
    const inst = render(React.createElement(PromptProbe));
    await waitFor(() => answerFn !== null);
    (answerFn as unknown as (v: string) => void)('yes');
    expect(capturedAnswer).toBe('yes');
  });
});
