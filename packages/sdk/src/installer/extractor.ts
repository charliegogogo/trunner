import { promises as fsp, createReadStream, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import AdmZip from 'adm-zip';
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
 * Both formats are handled in-process:
 * - `tar.gz` via the `tar` package.
 * - `.zip` via the `adm-zip` package (pure-JS, no system binary dependency).
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
 * Extract a `.zip` archive using `adm-zip` (pure-JS).
 *
 * Files are written via `fs.writeFile`, which means POSIX permission bits
 * stored in the zip are not preserved by the OS write — we re-apply `chmod`
 * using the external file attributes recorded in the zip header
 * (`entry.attr >> 16`). Anything matching `binaryMarker` is force-set to
 * `0o755` so it is executable on POSIX systems.
 */
async function extractZip(archivePath: string, destDir: string, binaryMarker: string): Promise<ExtractResult> {
  const zip = new AdmZip(archivePath);
  const files: string[] = [];
  let binaryPath: string | undefined;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const relPath = entry.entryName.split(/[\\/]/).join('/');
    const target = join(destDir, relPath);
    await ensureDir(dirname(target));
    await fsp.writeFile(target, entry.getData());

    const zipMode = (entry.attr >>> 16) & 0o777;
    if (relPath.includes(binaryMarker)) {
      binaryPath = target;
      await fsp.chmod(target, 0o755);
    } else if (zipMode && process.platform !== 'win32') {
      await fsp.chmod(target, zipMode);
    }

    files.push(relPath);
  }

  return { files, binaryPath };
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
