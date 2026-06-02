import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, getPaths, ensurePaths } from '../../src/env/index.js';
import { removeIfExists } from '../../src/utils/fs.js';

let home: string;
let store: ConfigStore;

beforeEach(async () => {
  home = join(tmpdir(), `trunner-cfg-${Date.now()}-${Math.random()}`);
  await ensurePaths(getPaths(home));
  store = new ConfigStore(getPaths(home));
});

afterEach(async () => {
  await removeIfExists(home);
});

describe('env/config', () => {
  it('load() returns default config on first run', async () => {
    const cfg = await store.load();
    expect(cfg.version).toBe(1);
    expect(cfg.activeTool).toBeNull();
    expect(cfg.tools).toEqual({});
  });

  it('save() persists changes', async () => {
    const cfg = await store.load();
    await store.save({ ...cfg, activeTool: 'terraform' });
    const reloaded = await store.load();
    expect(reloaded.activeTool).toBe('terraform');
  });

  it('pinTool adds an entry under tools', async () => {
    const cfg = await store.pinTool('terraform', {
      version: '1.6.0',
      installedAt: new Date().toISOString(),
      source: 'official',
    });
    expect(cfg.tools.terraform?.version).toBe('1.6.0');
    const reloaded = await store.load();
    expect(reloaded.tools.terraform?.version).toBe('1.6.0');
  });

  it('setActiveTool updates activeTool only', async () => {
    const cfg = await store.setActiveTool('opentofu');
    expect(cfg.activeTool).toBe('opentofu');
  });

  it('setBinaryMirror stores and persists a mirror URL', async () => {
    const cfg = await store.setBinaryMirror('https://mirror.example.com/bin');
    expect(cfg.mirror.binaries).toBe('https://mirror.example.com/bin');
    const reloaded = await store.load();
    expect(reloaded.mirror.binaries).toBe('https://mirror.example.com/bin');
  });
});
