import { describe, expect, it } from 'vitest';
import { sha256OfBuffer, verifySha256, verifySha256Buffer } from '../../src/installer/checksum.js';

describe('installer/checksum', () => {
  it('sha256OfBuffer matches a known digest', () => {
    const data = Buffer.from('hello world');
    // echo -n "hello world" | shasum -a 256
    expect(sha256OfBuffer(data)).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('verifySha256Buffer returns true on match and false on mismatch', () => {
    const data = Buffer.from('hello world');
    expect(verifySha256Buffer(data, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')).toBe(true);
    expect(verifySha256Buffer(data, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
    expect(verifySha256Buffer(data, 'short')).toBe(false);
  });

  it('verifySha256 reads from a file', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { promises: fsp } = await import('node:fs');
    const path = join(tmpdir(), `trunner-checksum-${Date.now()}.bin`);
    await fsp.writeFile(path, 'hello world');
    const ok = await verifySha256(path, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    const bad = await verifySha256(path, '0000000000000000000000000000000000000000000000000000000000000000');
    expect(ok).toBe(true);
    expect(bad).toBe(false);
    await fsp.unlink(path);
  });
});
