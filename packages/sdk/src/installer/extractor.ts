import { spawn } from 'node:child_process';
import { promises as fsp, createReadStream, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar';
import { ensureDir, removeIfExists } from '../utils/fs.js';
import type { PlatformInfo } from '../utils/os.js';

export interface ExtractResult {
  files: string[];
  binaryPath?: string;
}

export interface ExtractOptions {
  archivePath: string;
  destDir: string;
  /** Archive format override; if omitted, derived from the filename. */
  format?: 'zip' | 'tar.gz';
  platform: PlatformInfo;
  /** A path substring that, when matched, identifies the binary we want to mark as `binaryPath`. */
  binaryMarker: string;
}

/**
 * Extract a `.zip` or `.tar.gz` archive into `destDir`.
 * Returns all extracted file paths and the absolute path of the detected binary.
 *
 * `tar.gz` is handled in-process via the `tar` package. `.zip` is delegated to
 * the system `unzip` binary (available on macOS / Linux out of the box and
 * shipped with Git for Windows) for cross-platform reliability.
 */
export async function extractArchive(opts: ExtractOptions): Promise<ExtractResult> {
  const { archivePath, destDir, binaryMarker } = opts;
  await ensureDir(destDir);

  const format =
    opts.format ??
    deriveArchiveFormat(archivePath) ??
    (opts.platform.archiveExtension === 'zip' ? 'zip' : 'tar.gz');
  if (format === 'zip') {
    return extractZip(archivePath, destDir, binaryMarker);
  }
  return extractTarGz(archivePath, destDir, binaryMarker);
}

function deriveArchiveFormat(archivePath: string): 'zip' | 'tar.gz' | null {
  if (archivePath.endsWith('.zip')) return 'zip';
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) return 'tar.gz';
  return null;
}

async function extractTarGz(archivePath: string, destDir: string, binaryMarker: string): Promise<ExtractResult> {
  const files: string[] = [];
  let binaryPath: string | undefined;

  await tar.x({
    file: archivePath,
    cwd: destDir,
    gzip: true,
    onentry: (entry) => {
      files.push(entry.path);
      if (!binaryPath && entry.path.includes(binaryMarker)) {
        binaryPath = join(destDir, entry.path);
      }
    },
  });

  return { files, binaryPath };
}

/**
 * Use the system `unzip` to extract the archive, then locate the marked binary.
 * Relies on `unzip` being on PATH (true on macOS / Linux; for Windows we
 * recommend Git for Windows, which provides it).
 */
async function extractZip(archivePath: string, destDir: string, binaryMarker: string): Promise<ExtractResult> {
  await runProcess('unzip', ['-o', '-q', archivePath, '-d', destDir]);

  // Walk the extracted tree to find the marked binary and collect file names.
  const files: string[] = [];
  let binaryPath: string | undefined;
  await walkDir(destDir, (entryPath) => {
    const rel = entryPath.slice(destDir.length + 1);
    files.push(rel.split(/[\\/]/).join('/'));
    if (!binaryPath && entryPath.includes(binaryMarker)) {
      binaryPath = entryPath;
    }
  });
  return { files, binaryPath };
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

async function walkDir(root: string, visit: (absPath: string) => void | Promise<void>): Promise<void> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        await visit(full);
      }
    }
  }
}

/**
 * Extract only files matching `name` (e.g. for pulling a single provider zip out of a
 * combined archive). Used by provider installation flows.
 */
export async function extractTarGzStream(opts: {
  archivePath: string;
  destDir: string;
  filter: (entryPath: string) => boolean;
}): Promise<string[]> {
  const matched: string[] = [];
  await tar.x({
    file: opts.archivePath,
    cwd: opts.destDir,
    gzip: true,
    filter: (entryPath, entry) => {
      const e = entry as unknown as { type?: string };
      if (e.type === 'Directory') return false;
      if (!opts.filter(entryPath)) return false;
      matched.push(entryPath);
      return true;
    },
  });
  return matched;
}

/**
 * Extract a zip from a stream (provider mirrors) to a destination file.
 */
export async function streamToFile(stream: NodeJS.ReadableStream, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await pipeline(stream, createWriteStream(dest));
}

/**
 * Test helper: write a buffer to a temp file and extract it.
 */
export async function extractBuffer(opts: {
  buffer: Buffer;
  filename: string;
  destDir: string;
  binaryMarker: string;
}): Promise<ExtractResult> {
  const tmp = join(opts.destDir, opts.filename);
  await fsp.writeFile(tmp, opts.buffer);
  const ext = opts.filename.endsWith('.zip') ? 'zip' : 'tar.gz';
  const platform = ext === 'zip' ? ({ archiveExtension: 'zip' } as PlatformInfo) : ({ archiveExtension: 'tar.gz' } as PlatformInfo);
  const result = await extractArchive({
    archivePath: tmp,
    destDir: opts.destDir,
    platform,
    binaryMarker: opts.binaryMarker,
  });
  await removeIfExists(tmp);
  return result;
}

export async function gunzipToFile(src: string, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}
