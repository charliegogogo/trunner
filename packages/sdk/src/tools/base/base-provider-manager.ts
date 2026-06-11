import { join } from 'node:path';
import type { ToolId } from '../../types/tool.js';
import type { Logger } from '../../utils/logger.js';
import { NoopLogger } from '../../utils/logger.js';
import { getPlatformInfo, type PlatformInfo } from '../../utils/os.js';
import { ensureDir, removeIfExists } from '../../utils/fs.js';
import { download } from '../../installer/downloader.js';
import { getPaths, type TrunnerPaths } from '../../env/paths.js';
import type { ResolvedProvider } from '../../types/provider.js';

export interface ProviderSource {
  /** Resolve a single provider version into a downloadable artifact URL. */
  resolve(opts: { source: string; version: string; platform: PlatformInfo; arch: string }): Promise<ResolvedProvider>;
  /** List all available versions for a provider source on the current platform. */
  listVersions?(opts: { source: string; platform: PlatformInfo; signal?: AbortSignal }): Promise<Array<{ version: string; protocols?: string[] }>>;
}

export interface ProviderManagerOptions {
  toolId: ToolId;
  source: ProviderSource;
  paths?: TrunnerPaths;
  logger?: Logger;
  platform?: PlatformInfo;
  /** Provider installation root. */
  providersDir?: string;
}

export abstract class BaseProviderManager {
  protected readonly toolId: ToolId;
  protected readonly source: ProviderSource;
  protected readonly paths: TrunnerPaths;
  protected readonly logger: Logger;
  protected readonly platform: PlatformInfo;
  protected readonly providersDir: string;

  constructor(opts: ProviderManagerOptions) {
    this.toolId = opts.toolId;
    this.source = opts.source;
    this.paths = opts.paths ?? getPaths();
    this.logger = opts.logger ?? new NoopLogger();
    this.platform = opts.platform ?? getPlatformInfo();
    this.providersDir = opts.providersDir ?? join(this.paths.providers, this.toolId);
  }

  /** Filesystem path where a provider's binaries are mirrored. */
  pluginDir(source: string, version: string): string {
    const [ns, type] = source.split('/');
    return join(this.providersDir, 'plugins', 'registry.terraform.io', ns ?? source, type ?? source, version);
  }

  registryDir(): string {
    return join(this.providersDir, 'plugins', 'registry.terraform.io');
  }

  filesystemMirrorDir(): string {
    return join(this.providersDir, 'filesystem_mirror', 'registry.terraform.io');
  }

  async install(opts: { source: string; version: string; signal?: AbortSignal }): Promise<string> {
    const resolved = await this.source.resolve({
      source: opts.source,
      version: opts.version,
      platform: this.platform,
      arch: this.platform.arch,
    });

    const targetDir = this.pluginDir(opts.source, opts.version);
    await ensureDir(targetDir);

    const tmpArchive = join(this.paths.tmp, `provider-${Date.now()}-${resolved.filename}`);
    this.logger.info('downloading provider', {
      tool: this.toolId,
      source: opts.source,
      version: opts.version,
      url: resolved.downloadUrl,
    });
    await download({
      url: resolved.downloadUrl,
      dest: tmpArchive,
      logger: this.logger,
      signal: opts.signal,
    });

    const { extractArchive } = await import('../../installer/extractor.js');
    await extractArchive({
      archivePath: tmpArchive,
      destDir: targetDir,
      platform: this.platform,
      binaryMarker: 'terraform-provider',
    });

    await removeIfExists(tmpArchive);

    this.logger.info('provider installed', {
      tool: this.toolId,
      source: opts.source,
      version: opts.version,
      path: targetDir,
    });
    return targetDir;
  }

  /** List installed providers in the local mirror. */
  async listInstalled(): Promise<Array<{ source: string; version: string; path: string }>> {
    const { promises: fsp } = await import('node:fs');
    const root = this.registryDir();
    const out: Array<{ source: string; version: string; path: string }> = [];
    if (!(await exists(root))) return out;

    const namespaces = await fsp.readdir(root, { withFileTypes: true });
    for (const ns of namespaces) {
      if (!ns.isDirectory()) continue;
      const nsDir = join(root, ns.name);
      const types = await fsp.readdir(nsDir, { withFileTypes: true });
      for (const t of types) {
        if (!t.isDirectory()) continue;
        const tDir = join(nsDir, t.name);
        const versions = await fsp.readdir(tDir, { withFileTypes: true });
        for (const v of versions) {
          if (!v.isDirectory()) continue;
          out.push({ source: `${ns.name}/${t.name}`, version: v.name, path: join(tDir, v.name) });
        }
      }
    }
    return out;
  }

  /** List all available versions for a provider from the registry, cross-referenced with installed status. */
  async listAvailable(opts: { source: string; signal?: AbortSignal }): Promise<Array<{ version: string; installed: boolean }>> {
    if (!this.source.listVersions) return [];
    const allVersions = await this.source.listVersions({
      source: opts.source,
      platform: this.platform,
      signal: opts.signal,
    });
    const installed = await this.listInstalled();
    const installedSet = new Set(
      installed.filter((p) => p.source === opts.source).map((p) => p.version),
    );
    return allVersions.map((v) => ({
      version: v.version,
      installed: installedSet.has(v.version),
    }));
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    const { promises: fsp } = await import('node:fs');
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
