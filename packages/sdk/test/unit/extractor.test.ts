import { describe, expect, it } from 'vitest';
import { extractBuffer } from '../../src/installer/extractor.js';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeIfExists } from '../../src/utils/fs.js';
import * as tar from 'tar';

describe('installer/extractor (tar.gz)', () => {
  it('extracts a tar.gz archive and locates a marked binary', async () => {
    const destDir = join(tmpdir(), `trunner-extract-${Date.now()}`);
    await fsp.mkdir(destDir, { recursive: true });

    // Build a tar.gz buffer with one binary file.
    const stageDir = join(destDir, 'stage');
    await fsp.mkdir(stageDir, { recursive: true });
    const binaryPath = join(stageDir, 'terraform');
    await fsp.writeFile(binaryPath, '#!/bin/sh\necho terraform\n');
    await fsp.chmod(binaryPath, 0o755);
    const tarPath = join(destDir, 'terraform.tar.gz');
    await tar.c({ gzip: true, file: tarPath, cwd: stageDir }, ['terraform']);

    const outDir = join(destDir, 'out');
    await fsp.mkdir(outDir, { recursive: true });
    const result = await extractBuffer({
      buffer: await fsp.readFile(tarPath),
      filename: 'terraform.tar.gz',
      destDir: outDir,
      binaryMarker: 'terraform',
    });

    expect(result.files).toContain('terraform');
    expect(result.binaryPath).toBeDefined();
    expect(result.binaryPath?.endsWith('terraform')).toBe(true);

    await removeIfExists(destDir);
  });
});
