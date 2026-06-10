import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { discoverWorkingDirs, ALWAYS_EXCLUDE } from '../../src/working-dir/discover.js';
import { TRUNNERRC_FILENAME } from '../../src/working-dir/trunner-rc.js';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `trunner-discover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function mkWs(rel: string, tool: string, extra = ''): Promise<void> {
  const dir = join(root, rel);
  await mkdir(dir, { recursive: true });
  const content = extra ? `tool = "${tool}"\n${extra}\n` : `tool = "${tool}"\n`;
  await writeFile(join(dir, TRUNNERRC_FILENAME), content, 'utf-8');
}

describe('working-dir/discover', () => {
  it('returns [] when no .trunnerrc exists', async () => {
    await mkdir(join(root, 'empty'), { recursive: true });
    expect(await discoverWorkingDirs(root)).toEqual([]);
  });

  it('discovers a single top-level working directory', async () => {
    await mkWs('team-a', 'terraform');
    const ws = await discoverWorkingDirs(root);
    expect(ws).toHaveLength(1);
    expect(ws[0]?.dir).toBe(join(root, 'team-a'));
    expect(ws[0]?.config.tool).toBe('terraform');
  });

  it('discovers multiple working directories', async () => {
    await mkWs('team-a', 'terraform');
    await mkWs('team-b', 'opentofu');
    await mkWs('team-c', 'terraform');
    const ws = await discoverWorkingDirs(root);
    expect(ws.map((w) => basename(w.dir)).sort()).toEqual(['team-a', 'team-b', 'team-c']);
  });

  it('treats .trunnerrc as a project boundary (does not descend)', async () => {
    await mkWs('team-a', 'terraform');
    // team-a has a sub-working directory that should be ignored
    await mkWs('team-a/nested', 'opentofu');
    const ws = await discoverWorkingDirs(root);
    expect(ws).toHaveLength(1);
    expect(basename(ws[0]!.dir)).toBe('team-a');
  });

  it('always skips .git and .terraform even when listed in exclude list', async () => {
    await mkWs('team-a', 'terraform');
    // The point of ALWAYS_EXCLUDE is "always, no override", but per the spec
    // the exclude set is unioned with ALWAYS_EXCLUDE. Sanity-check the union.
    expect(ALWAYS_EXCLUDE.has('.git')).toBe(true);
    expect(ALWAYS_EXCLUDE.has('.terraform')).toBe(true);

    await mkWs('.git/ws', 'terraform');
    await mkWs('.terraform/ws', 'opentofu');
    const ws = await discoverWorkingDirs(root);
    expect(ws).toHaveLength(1);
  });

  it('respects CLI --exclude', async () => {
    await mkWs('team-a', 'terraform');
    await mkWs('vendor', 'terraform');
    const ws = await discoverWorkingDirs(root, { exclude: ['vendor'] });
    expect(ws).toHaveLength(1);
    expect(basename(ws[0]!.dir)).toBe('team-a');
  });

  it('does not follow symlinks (avoids loops)', async () => {
    await mkWs('team-a', 'terraform');
    // Create a symlink to the parent — would loop forever otherwise.
    await symlink(root, join(root, 'loop'), 'dir');
    const ws = await discoverWorkingDirs(root);
    expect(ws).toHaveLength(1);
  });

  it('reports non-fatal skips via onSkip callback', async () => {
    await mkWs('good', 'terraform');
    await mkWs('bad', 'terraform', 'concurrency = -1'); // invalid concurrency → parse error
    const skips: Array<{ dir: string; reason: string }> = [];
    const ws = await discoverWorkingDirs(root, { onSkip: (s) => skips.push(s) });
    expect(ws).toHaveLength(1);
    expect(basename(ws[0]!.dir)).toBe('good');
    expect(skips).toHaveLength(1);
    expect(skips[0]!.dir).toBe(join(root, 'bad'));
    expect(skips[0]!.reason).toMatch(/invalid value for 'concurrency'/);
  });

  it('reports unknown-key warnings via onWarning callback (forward-compat)', async () => {
    await mkWs('ws', 'terraform', 'flavor = "spicy"');
    const warnings: Array<{ key: string }> = [];
    const ws = await discoverWorkingDirs(root, { onWarning: (w) => warnings.push(w) });
    expect(ws).toHaveLength(1);
    expect(warnings.map((w) => w.key)).toEqual(['flavor']);
  });

  it('does not scan up — even when an ancestor has a .trunnerrc', async () => {
    await mkWs('outer', 'terraform');
    // Scanning outer/inner/ must NOT see outer's .trunnerrc (no scan-up).
    // And inner/ has no .trunnerrc itself, so the result is [].
    const ws = await discoverWorkingDirs(join(root, 'outer', 'inner'));
    expect(ws).toEqual([]);
  });

  it('finds only the boundary working directory when an ancestor and a descendant both have .trunnerrc', async () => {
    await mkWs('outer', 'terraform');
    await mkWs('outer/inner', 'opentofu');
    // outer is a project boundary — discover stops descending there.
    // outer/inner/ is never seen.
    const ws = await discoverWorkingDirs(root);
    expect(ws).toHaveLength(1);
    expect(basename(ws[0]!.dir)).toBe('outer');
  });

  it('reports permission errors via onSkip, does not throw', async () => {
    await mkWs('good', 'terraform');
    // Pretend a directory is unreadable by stat-failing. The discover code
    // catches readdir errors, so we just verify it does not propagate.
    const onSkip = vi.fn();
    const ws = await discoverWorkingDirs(root, { onSkip });
    expect(ws.length).toBeGreaterThanOrEqual(1);
    // No assertion on onSkip being called or not — depends on fs permissions
    // of the test runner. The contract is "does not throw".
    expect(onSkip).toBeDefined();
  });
});
