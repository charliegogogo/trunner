import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { getPlatformInfo } from '../../src/utils/os.js';
import { getPaths, type TrunnerPaths } from '../../src/env/paths.js';
import { BaseBinaryManager } from '../../src/tools/base/base-binary-manager.js';
import type { ReleaseSource } from '../../src/tools/base/base-binary-manager.js';

const RELEASE_SOURCE: ReleaseSource = {
  async listVersions() { return []; },
  async resolve() { throw new Error('not used'); },
};

class FakeBinaryManager extends BaseBinaryManager {
  constructor(paths: TrunnerPaths) {
    super({
      toolId: 'terraform',
      binaryName: 'terraform',
      releaseSource: RELEASE_SOURCE,
      paths,
    });
  }
}

let home: string;
let paths: TrunnerPaths;
let mgr: FakeBinaryManager;
const platform = getPlatformInfo();

beforeEach(async () => {
  home = join(tmpdir(), `trunner-bm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  paths = getPaths(home);
  await mkdir(paths.binaries, { recursive: true });
  mgr = new FakeBinaryManager(paths);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function touchBinary(version: string): Promise<string> {
  const name = `terraform-${version}${platform.binaryExtension}`;
  const p = join(mgr.binariesDir(), name);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, '#!/bin/sh\nexit 0\n');
  if (!platform.isWindows) await chmod(p, 0o755);
  return p;
}

describe('BaseBinaryManager.listInstalled', () => {
  it('returns [] when binaries dir is empty', async () => {
    expect(await mgr.listInstalled()).toEqual([]);
  });

  it('returns [] when binaries dir does not exist', async () => {
    await rm(paths.binaries, { recursive: true, force: true });
    expect(await mgr.listInstalled()).toEqual([]);
  });

  it('returns installed versions sorted newest-first', async () => {
    await touchBinary('1.6.6');
    await touchBinary('1.7.0');
    await touchBinary('1.5.3');
    const got = await mgr.listInstalled();
    expect(got).toEqual(['1.7.0', '1.6.6', '1.5.3']);
  });

  it('handles 1.10.0 vs 1.9.0 numerically (not lexicographically)', async () => {
    await touchBinary('1.9.0');
    await touchBinary('1.10.0');
    expect(await mgr.listInstalled()).toEqual(['1.10.0', '1.9.0']);
  });

  it('ignores unrelated files in the binaries dir', async () => {
    await touchBinary('1.6.6');
    await writeFile(join(paths.binaries, 'README.md'), 'noise');
    await writeFile(join(paths.binaries, '.DS_Store'), 'noise');
    expect(await mgr.listInstalled()).toEqual(['1.6.6']);
  });

  it('ignores files with the wrong extension on Windows', async () => {
    if (!platform.isWindows) return; // only meaningful on Windows
    await writeFile(join(paths.binaries, 'terraform-1.6.6'), 'should be ignored on windows');
    expect(await mgr.listInstalled()).toEqual([]);
  });
});
