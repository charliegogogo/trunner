import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { CliFlags } from '../../src/types.js';

const baseFlags: CliFlags = {
  cwd: process.cwd(),
  exclude: [],
  includePrerelease: false,
  json: false,
  quiet: false,
  autoApprove: false,
  color: true,
  altScreen: true,
};

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function freshTmp(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'trunner-app-'));
  return tmpDir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('App discover errors', () => {
  it('reports a parse error when the immediate cwd has a malformed .trunnerrc', async () => {
    const dir = freshTmp();
    // Bare value (unquoted) — invalid TOML.
    writeFileSync(join(dir, '.trunnerrc'), 'tool = terraform\n');
    const inst = render(React.createElement(App, {
      command: 'plan',
      commandArgs: [],
      flags: { ...baseFlags, cwd: dir, json: true },
    }));
    await waitFor(() => (inst.lastFrame() ?? '').includes('error:'));
    // Ink wraps the frame at word boundaries, so "TOML parse" can land
    // at the end of one line and "error:" at the start of the next.
    // Strip whitespace before regex-matching.
    const flat = (inst.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/error:/);
    expect(flat).toMatch(/TOML parse/);
    expect(flat).toMatch(/\.trunnerrc/);
    expect(flat).toMatch(/or pass --cwd <path>/);
  });

  it('reports the generic no-rc error when the cwd has no .trunnerrc at all', async () => {
    const dir = freshTmp();
    const inst = render(React.createElement(App, {
      command: 'plan',
      commandArgs: [],
      flags: { ...baseFlags, cwd: dir, json: true },
    }));
    await waitFor(() => (inst.lastFrame() ?? '').includes('error:'));
    const flat = (inst.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/error: no \.trunnerrc found/);
    expect(flat).not.toMatch(/TOML parse/);
  });

  it('does not surface a parse error when the bad .trunnerrc is in a sibling subdirectory, not the cwd', async () => {
    const dir = freshTmp();
    // .trunnerrc in a child dir is a project boundary — the walk does not
    // descend and its parse error should not bubble up to the cwd-level
    // error path. discover() returns 0 for the cwd with no other RC.
    mkdirSync(join(dir, 'child'));
    writeFileSync(join(dir, 'child', '.trunnerrc'), 'tool = terraform\n');
    const inst = render(React.createElement(App, {
      command: 'plan',
      commandArgs: [],
      flags: { ...baseFlags, cwd: dir, json: true },
    }));
    await waitFor(() => (inst.lastFrame() ?? '').includes('error:'));
    const flat = (inst.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/error: no \.trunnerrc found/);
    expect(flat).not.toMatch(/TOML parse/);
  });
});
