import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { parseRc, rcPathFor, RcParseError, TRUNNERRC_FILENAME } from '../../src/working-dir/trunner-rc.js';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `trunner-rc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRc(name: string, content: string): Promise<string> {
  const ws = join(root, name);
  await mkdir(ws, { recursive: true });
  const path = rcPathFor(ws);
  await writeFile(path, content, 'utf-8');
  return path;
}

describe('working-dir/trunner-rc', () => {
  it('parses a minimal rc with just the tool field', async () => {
    const path = await writeRc('a', 'tool = "terraform"\n');
    const { config, warnings } = await parseRc(path);
    expect(config.tool).toBe('terraform');
    expect(config.path).toBe(path);
    expect(warnings).toEqual([]);
    expect(config.version).toBeUndefined();
  });

  it('parses all optional fields', async () => {
    const path = await writeRc(
      'b',
      [
        'tool = "opentofu"',
        'version = "~> 1.6"',
      ].join('\n'),
    );
    const { config, warnings } = await parseRc(path);
    expect(config.tool).toBe('opentofu');
    expect(config.version).toBe('~> 1.6');
    expect(warnings).toEqual([]);
  });

  it('maps the "tofu" alias to "opentofu"', async () => {
    const path = await writeRc('c', 'tool = "tofu"\n');
    const { config } = await parseRc(path);
    expect(config.tool).toBe('opentofu');
  });

  it('defaults tool to terraform when the tool field is missing', async () => {
    const path = await writeRc('d', 'version = "~> 1.5"\n');
    const { config } = await parseRc(path);
    expect(config.tool).toBe('terraform');
  });

  it('throws RcParseError when the tool value is invalid', async () => {
    const path = await writeRc('e', 'tool = "pants"\n');
    await expect(parseRc(path)).rejects.toThrow(/invalid value for 'tool'/);
  });

  it('returns warnings (not errors) for unknown keys', async () => {
    const path = await writeRc(
      'f',
      ['tool = "terraform"', 'flavor = "spicy"', 'future = 42'].join('\n'),
    );
    const { config, warnings } = await parseRc(path);
    expect(config.tool).toBe('terraform');
    expect(warnings).toHaveLength(2);
    const keys = warnings.map((w) => w.key).sort();
    expect(keys).toEqual(['flavor', 'future']);
  });

  it('throws RcParseError for a TOML parse error', async () => {
    const path = await writeRc('g', 'tool = "terraform\n'); // unterminated string
    await expect(parseRc(path)).rejects.toBeInstanceOf(RcParseError);
    await expect(parseRc(path)).rejects.toThrow(/TOML parse error/);
  });

  it('errors when the rc file is missing', async () => {
    const path = join(root, 'missing', TRUNNERRC_FILENAME);
    await expect(parseRc(path)).rejects.toBeInstanceOf(RcParseError);
    await expect(parseRc(path)).rejects.toThrow(/could not read/);
  });

  it('rcPathFor joins dir + filename', () => {
    expect(rcPathFor('/tmp/x')).toBe(join('/tmp/x', TRUNNERRC_FILENAME));
  });
});
