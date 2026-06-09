import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import React, { useRef } from 'react';
import { render, Box, Text, useBoxMetrics, type DOMElement, type Instance as InkInstance } from 'ink';
import { StatusBar } from '../../src/ui/StatusBar.js';
import { WorkspacePane } from '../../src/ui/WorkspacePane.js';
import type { WorkspaceDisplay } from '../../src/hooks/useWorkspaces.js';

type FakeStdout = {
  columns: number;
  isTTY: boolean;
  on: (e: string, l: (...args: unknown[]) => void) => FakeStdout;
  once: (e: string, l: (...args: unknown[]) => void) => FakeStdout;
  off: (e: string, l: (...args: unknown[]) => void) => FakeStdout;
  addListener: (e: string, l: (...args: unknown[]) => void) => FakeStdout;
  removeListener: (e: string, l: (...args: unknown[]) => void) => FakeStdout;
  emit: (e: string) => boolean;
  write: (data: string) => boolean;
  getWrites: () => string[];
  listenerCount: (e: string) => number;
};

type FakeStdin = EventEmitter & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  ref: () => void;
  unref: () => void;
  setEncoding: () => void;
  read: () => null;
};

function createStdio(columns = 100): { stdout: FakeStdout; stdin: FakeStdin } {
  const writes: string[] = [];
  const ee = new EventEmitter();
  const stdout: FakeStdout = {
    columns,
    isTTY: true,
    on: (e, l) => {
      ee.on(e, l as (...args: unknown[]) => void);
      return stdout;
    },
    once: (e, l) => {
      ee.once(e, l as (...args: unknown[]) => void);
      return stdout;
    },
    off: (e, l) => {
      ee.off(e, l as (...args: unknown[]) => void);
      return stdout;
    },
    addListener: (e, l) => {
      ee.addListener(e, l as (...args: unknown[]) => void);
      return stdout;
    },
    removeListener: (e, l) => {
      ee.removeListener(e, l as (...args: unknown[]) => void);
      return stdout;
    },
    emit: (e) => ee.emit(e),
    write: (data) => {
      writes.push(data);
      return true;
    },
    getWrites: () => writes.slice(),
    listenerCount: (e) => ee.listenerCount(e),
  };

  const stdin = new EventEmitter() as FakeStdin;
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.setEncoding = () => {};
  stdin.read = () => null;

  return { stdout, stdin };
}

function setColumnsAndResize(stdout: FakeStdout, cols: number): void {
  stdout.columns = cols;
  stdout.emit('resize');
}

function makeWs(dir: string, overrides: Partial<WorkspaceDisplay> = {}): WorkspaceDisplay {
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
    parsedResult: null,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function getWriteContents(stdout: FakeStdout): string[] {
  return stdout
    .getWrites()
    .filter((w) => !w.startsWith('\u001b[?25') && !w.startsWith('\u001b[?2026'));
}

let lastInstance: InkInstance | null = null;

function trackedRender(
  tree: React.ReactElement,
  stdout: FakeStdout,
  stdin?: FakeStdin,
): InkInstance {
  const inst = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: (stdin as unknown as NodeJS.ReadStream) ?? undefined,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  lastInstance = inst;
  return inst;
}

afterEach(async () => {
  if (lastInstance) {
    lastInstance.unmount();
    await new Promise((r) => setTimeout(r, 10));
    lastInstance = null;
  }
});

describe('resize: StatusBar spans current terminal width', () => {
  it('initial render at 100 cols yields a 100-cell border', async () => {
    const { stdout, stdin } = createStdio(100);
    const inst = trackedRender(
      React.createElement(StatusBar, {
        workspaces: [makeWs('/tmp/a'), makeWs('/tmp/b')],
        focusedIndex: 0,
      }),
      stdout,
      stdin,
    );
    await inst.waitUntilRenderFlush();

    const writes = getWriteContents(stdout);
    const last = stripAnsi(writes.at(-1) ?? '');
    const topBorder = last.split('\n').find((l) => /[┌╭]/.test(l));
    expect(topBorder).toBeDefined();
    expect((topBorder ?? '').length).toBeGreaterThanOrEqual(98);
    expect((topBorder ?? '').length).toBeLessThanOrEqual(102);
  });

  it('border reflows to a smaller width on stdout resize', async () => {
    const { stdout, stdin } = createStdio(100);
    const inst = trackedRender(
      React.createElement(StatusBar, {
        workspaces: [makeWs('/tmp/a')],
        focusedIndex: 0,
      }),
      stdout,
      stdin,
    );
    await inst.waitUntilRenderFlush();
    // Sanity: listener should be attached (interactive mode).
    expect(stdout.listenerCount('resize')).toBeGreaterThan(0);

    setColumnsAndResize(stdout, 60);
    await waitFor(() => {
      const last = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
      const border = last.split('\n').find((l) => /[┌╭]/.test(l)) ?? '';
      return border.length > 0 && border.length < 80;
    });

    const last = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
    const newBorder = last.split('\n').find((l) => /[┌╭]/.test(l)) ?? '';
    // After resize to 60 cols, the border should be ~60 cells (±2).
    expect(newBorder.length).toBeGreaterThanOrEqual(58);
    expect(newBorder.length).toBeLessThanOrEqual(62);
  });
});

describe('resize: useBoxMetrics + WorkspacePane', () => {
  it('useBoxMetrics ref returns the rendered box width, updates on resize', async () => {
    const { stdout, stdin } = createStdio(100);
    function WidthProbe(): React.ReactElement {
      const ref = useRef<DOMElement>(null);
      const { width, hasMeasured } = useBoxMetrics(ref);
      return (
        <Box ref={ref} flexDirection="column" borderStyle="round" paddingX={1} width="100%">
          <Text>
            m:{hasMeasured ? '1' : '0'} w:{width}
          </Text>
        </Box>
      );
    }
    const inst = trackedRender(<WidthProbe />, stdout, stdin);
    await inst.waitUntilRenderFlush();

    const initial = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
    expect(initial).toMatch(/m:1 w:100/);

    setColumnsAndResize(stdout, 60);
    await waitFor(() => {
      const last = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
      return /m:1 w:6/.test(last);
    });
    // Allow the post-resize render to settle (Ink's throttle is ~33ms).
    await new Promise((r) => setTimeout(r, 80));
    const frame = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
    expect(frame).toMatch(/w:6[0-2]/);
  });

  it('WorkspacePane contentWidth shrinks on resize and truncates long lines with ellipsis', async () => {
    // 200 cols gives ample headroom so the 80-char line is NOT truncated
    // at startup; resizing to 40 cols forces OutputView's truncation to
    // kick in. We assert the count of visible 'x' chars shrinks.
    const { stdout, stdin } = createStdio(200);
    const longLine = 'x'.repeat(80);
    const ws = makeWs('/tmp/a', {
      state: 'exited',
      stdout: longLine,
      stderr: '',
      exitCode: 0,
      endedAt: Date.now(),
    });
    const inst = trackedRender(
      <WorkspacePane
        workspace={ws}
        command="plan"
        commandArgs={[]}
        autoApprove={false}
        color
        isFocused
        onPromptAnswer={() => {}}
        onTab={() => {}}
      />,
      stdout,
      stdin,
    );
    await inst.waitUntilRenderFlush();

    // Count how many 'x' chars are visible per line at 200 cols (full
    // line should fit, plus we know there are exactly 80 x's).
    const initial = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
    const initialXRun = initial.match(/x+/g);
    expect(initialXRun).toBeDefined();
    const initialXCount = Math.max(...(initialXRun ?? []).map((r) => r.length));
    expect(initialXCount).toBe(80);

    setColumnsAndResize(stdout, 40);
    // OutputView truncates per-line to (contentWidth - 1) with …. After
    // resize to 40 cols, contentWidth is ~40-4=36, so the visible x-run
    // shrinks to <80 and the truncation marker appears.
    await waitFor(() => {
      const last = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
      const runs = last.match(/x+/g) ?? [];
      const maxRun = runs.length > 0 ? Math.max(...runs.map((r) => r.length)) : 0;
      return maxRun < 80 && last.includes('…');
    });

    const after = stripAnsi(getWriteContents(stdout).at(-1) ?? '');
    expect(after).toContain('…');
    const afterRuns = after.match(/x+/g) ?? [];
    const afterMaxRun = afterRuns.length > 0 ? Math.max(...afterRuns.map((r) => r.length)) : 0;
    expect(afterMaxRun).toBeLessThan(80);
  });
});
