import { describe, expect, it } from 'vitest';
import { ensureDir, exists, readJsonFile, removeIfExists, writeJsonFile } from '../../src/utils/fs.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils/fs', () => {
  it('ensureDir creates nested directories', async () => {
    const dir = join(tmpdir(), `trunner-test-${Date.now()}-${Math.random()}`);
    await ensureDir(join(dir, 'a', 'b', 'c'));
    expect(await exists(join(dir, 'a', 'b', 'c'))).toBe(true);
    await removeIfExists(dir);
  });

  it('exists returns false for missing paths', async () => {
    expect(await exists('/this/does/not/exist/abc/xyz')).toBe(false);
  });

  it('writeJsonFile / readJsonFile round-trips', async () => {
    const path = join(tmpdir(), `trunner-test-${Date.now()}.json`);
    const data = { a: 1, b: ['x', 'y'] };
    await writeJsonFile(path, data);
    const back = await readJsonFile<typeof data>(path);
    expect(back).toEqual(data);
    await removeIfExists(path);
  });

  it('readJsonFile returns null for missing files', async () => {
    const out = await readJsonFile('/definitely/not/here.json');
    expect(out).toBeNull();
  });
});
