import { join } from 'node:path';
import { chmod, readdir } from 'node:fs/promises';
import type { ToolId, VersionInfo } from '../../types/tool.js';
import type { ProgressInfo } from '../../types/events.js';
import type { Logger } from '../../utils/logger.js';
import { ConsoleLogger, NoopLogger } from '../../utils/logger.js';
import { getPlatformInfo, type PlatformInfo } from '../../utils/os.js';
import { download } from '../../installer/downloader.js';
import { extractArchive } from '../../installer/extractor.js';
import { verifySha256 } from '../../installer/checksum.js';
import { ensureDir, exists, removeIfExists } from '../../utils/fs.js';
import type { TrunnerPaths } from '../../env/paths.js';
import { getPaths } from '../../env/paths.js';

export interface ReleaseEntry {
  version: string;
  url: string;
  /** SHA256 hex of the archive; optional — absence skips verification. */
  sha256?: string;
  /** Per-platform asset name override. */
  filename?: string;
  /** Archive format. Defaults to deriving from `filename` if not set. */
  archiveFormat?: 'zip' | 'tar.gz';
}

export interface ReleaseSource {
  /** List known versions, newest first. */
  listVersions(opts?: { signal?: AbortSignal; limit?: number }): Promise<string[]>;
  /** Resolve a concrete download entry for a version on the current platform. */
  resolve(opts: { version: string; platform: PlatformInfo; signal?: AbortSignal }): Promise<ReleaseEntry>;
}

export interface BinaryManagerOptions {
  toolId: ToolId;
  binaryName: string;            // e.g. "terraform"
  releaseSource: ReleaseSource;
  paths?: TrunnerPaths;
  logger?: Logger;
  platform?: PlatformInfo;
}

export abstract class BaseBinaryManager {
  protected readonly toolId: ToolId;
  protected readonly binaryName: string;
  protected readonly releaseSource: ReleaseSource;
  protected readonly paths: TrunnerPaths;
  protected readonly logger: Logger;
  protected readonly platform: PlatformInfo;

  constructor(opts: BinaryManagerOptions) {
    this.toolId = opts.toolId;
    this.binaryName = opts.binaryName;
    this.releaseSource = opts.releaseSource;
    this.paths = opts.paths ?? getPaths();
    this.logger = opts.logger ?? new NoopLogger();
    this.platform = opts.platform ?? getPlatformInfo();
  }

  /** Absolute path to the installed binary if present. */
  binaryPath(version: string): string {
    return join(this.binariesDir(), `${this.binaryName}-${version}${this.platform.binaryExtension}`);
  }

  installedVersionDir(): string {
    return join(this.paths.binaries, this.toolId);
  }

  binariesDir(): string {
    return join(this.paths.binaries, this.toolId);
  }

  cacheDir(): string {
    return join(this.paths.cache, this.toolId);
  }

  downloadsDir(): string {
    return join(this.paths.downloads, this.toolId);
  }

  isInstalled(version: string): Promise<boolean> {
    return exists(this.binaryPath(version));
  }

  /**
   * Ensure a binary for `version` is present in the local cache. Downloads
   * (and verifies, if a checksum is provided) and extracts as needed.
   */
  async ensureInstalled(opts: {
    version: string;
    signal?: AbortSignal;
    force?: boolean;
    onProgress?: (info: ProgressInfo) => void;
  }): Promise<string> {
    const { version } = opts;
    const target = this.binaryPath(version);
    if (!opts.force && (await exists(target))) {
      this.logger.debug('binary already installed', { tool: this.toolId, version, target });
      return target;
    }

    await ensureDir(this.binariesDir());
    await ensureDir(this.cacheDir());
    await ensureDir(this.downloadsDir());

    const entry = await this.releaseSource.resolve({
      version,
      platform: this.platform,
      signal: opts.signal,
    });

    const archivePath = join(this.downloadsDir(), entry.filename ?? `${this.binaryName}-${version}.archive`);

    if (opts.force || !(await exists(archivePath))) {
      this.logger.info('downloading binary', {
        tool: this.toolId,
        version,
        url: entry.url,
      });
      await download({
        url: entry.url,
        dest: archivePath,
        logger: this.logger,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
    } else {
      this.logger.debug('archive already cached', { archivePath });
    }

    if (entry.sha256) {
      this.logger.debug('verifying checksum', { tool: this.toolId, version });
      const ok = await verifySha256(archivePath, entry.sha256);
      if (!ok) {
        await removeIfExists(archivePath);
        throw new Error(`Checksum mismatch for ${this.toolId} ${version}`);
      }
    }

    const stageDir = join(this.cacheDir(), `${this.binaryName}-${version}`);
    await removeIfExists(stageDir);
    await ensureDir(stageDir);

    this.logger.info('extracting archive', { tool: this.toolId, version });
    const result = await extractArchive({
      archivePath,
      destDir: stageDir,
      ...(entry.archiveFormat ? { format: entry.archiveFormat } : {}),
      platform: this.platform,
      binaryMarker: this.binaryName,
    });

    if (!result.binaryPath) {
      throw new Error(`Could not locate binary ${this.binaryName} in extracted archive`);
    }

    // Move the binary to its versioned location.
    const { rename } = await import('node:fs/promises');
    await rename(result.binaryPath, target);

    if (!this.platform.isWindows) {
      await chmod(target, 0o755);
    }

    await removeIfExists(stageDir);

    this.logger.info('binary installed', { tool: this.toolId, version, target });
    return target;
  }

  async uninstall(version: string): Promise<void> {
    const target = this.binaryPath(version);
    await removeIfExists(target);
  }

  /** Probe a binary path with `--version` to read its version string. */
  async detectInstalledVersion(version: string): Promise<VersionInfo | null> {
    if (!(await this.isInstalled(version))) return null;
    return { version, raw: version, source: 'installed' };
  }

  /**
   * List installed tool binary versions, newest-first. Returns version strings
   * (e.g. `["1.7.0", "1.6.6"]`) parsed from the `${binaryName}-${version}${ext}`
   * filenames in `binariesDir()`. Unknown / non-conforming filenames are
   * silently skipped.
   */
  async listInstalled(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.binariesDir());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const prefix = `${this.binaryName}-`;
    const ext = this.platform.binaryExtension;
    const versions: string[] = [];
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      if (ext && !name.endsWith(ext)) continue;
      if (ext && name.length <= prefix.length + ext.length) continue;
      const version = name.slice(prefix.length, ext ? -ext.length : undefined);
      if (version.length === 0) continue;
      versions.push(version);
    }
    versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    return versions;
  }

  /** List ALL available versions from the release source, merged with install status. */
  async listAvailable(opts?: { signal?: AbortSignal }): Promise<Array<{ version: string; installed: boolean }>> {
    const [allVersions, installedVersions] = await Promise.all([
      this.releaseSource.listVersions({ signal: opts?.signal }),
      this.listInstalled(),
    ]);
    const installedSet = new Set(installedVersions);
    return allVersions.map((v) => ({ version: v, installed: installedSet.has(v) }));
  }

  // For subclass overrides (e.g. provider mirroring).
  protected useMirror(url: string): string {
    return url;
  }
}
