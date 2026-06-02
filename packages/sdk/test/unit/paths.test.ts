import { describe, expect, it } from 'vitest';
import { ensurePaths, getPaths } from '../../src/env/paths.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeIfExists } from '../../src/utils/fs.js';

describe('env/paths', () => {
  it('getPaths() defaults to ~/.trunner layout', () => {
    const p = getPaths();
    expect(p.home).toMatch(/\.trunner$/);
    expect(p.binaries).toMatch(/[\\/]binaries$/);
    expect(p.providers).toMatch(/[\\/]providers$/);
    expect(p.configFile).toMatch(/[\\/]config[\\/]config\.json$/);
  });

  it('getPaths(home) builds a custom layout', () => {
    const home = join(tmpdir(), 'trunner-test-custom');
    const p = getPaths(home);
    expect(p.home).toBe(home);
    expect(p.binaries).toBe(join(home, 'binaries'));
  });

  it('ensurePaths creates all directories', async () => {
    const home = join(tmpdir(), `trunner-test-ensure-${Date.now()}`);
    const p = await ensurePaths(getPaths(home));
    expect(p.home).toBe(home);
    const { promises: fsp } = await import('node:fs');
    const stat = await fsp.stat(p.binaries);
    expect(stat.isDirectory()).toBe(true);
    await removeIfExists(home);
  });
});
