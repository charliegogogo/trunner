import { promises as fs } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import type { Dirent } from 'node:fs';
import { parseRc, type ParseRcWarning, type TrunnerRc } from './trunner-rc.js';

export interface WorkingDir {
  readonly dir: string;
  readonly config: TrunnerRc;
}

export interface DiscoverOptions {
  /** Extra directory basenames to skip during the scan. */
  readonly exclude?: readonly string[];
  /** Callback for forward-compat warnings (e.g. unknown .trunnerrc keys). */
  readonly onWarning?: (w: ParseRcWarning) => void;
  /** Callback for non-fatal scan issues (bad .trunnerrc, permission errors). */
  readonly onSkip?: (info: { dir: string; reason: string }) => void;
}

export const ALWAYS_EXCLUDE: ReadonlySet<string> = new Set(['.git', '.terraform']);

const DEFAULT_OPTIONS: Required<Omit<DiscoverOptions, 'onWarning' | 'onSkip'>> = {
  exclude: [],
};

export async function discoverWorkingDirs(
  cwd: string,
  opts: DiscoverOptions = {},
): Promise<WorkingDir[]> {
  const results: WorkingDir[] = [];
  const root = resolve(cwd);
  const baseExclude = new Set<string>([...ALWAYS_EXCLUDE, ...(opts.exclude ?? DEFAULT_OPTIONS.exclude)]);
  await walk(root, baseExclude, results, opts);
  return results;
}

async function walk(
  dir: string,
  exclude: Set<string>,
  results: WorkingDir[],
  opts: DiscoverOptions,
): Promise<void> {
  if (exclude.has(basename(dir))) return;

  const rcPath = join(dir, '.trunnerrc');
  if (await fileExists(rcPath)) {
    try {
      const { config, warnings } = await parseRc(rcPath);
      for (const w of warnings) opts.onWarning?.(w);
      results.push({ dir, config });
    } catch (err) {
      // A malformed .trunnerrc blocks only its own working directory; siblings continue.
      opts.onSkip?.({ dir, reason: (err as Error).message });
    }
    return; // project boundary — do not descend
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    opts.onSkip?.({ dir, reason: `readdir failed: ${(err as Error).message}` });
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    await walk(join(dir, entry.name), exclude, results, opts);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
