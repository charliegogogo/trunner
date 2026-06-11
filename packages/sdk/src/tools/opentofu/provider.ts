import { BaseProviderManager, type ProviderSource, type ProviderManagerOptions } from '../base/base-provider-manager.js';
import { archiveNameFor, type PlatformInfo } from '../../utils/os.js';
import { fetchBuffer } from '../../installer/downloader.js';
import type { ResolvedProvider } from '../../types/provider.js';

const REGISTRY_URL = 'https://registry.opentofu.org';

/**
 * Resolves provider packages via the OpenTofu Registry.
 */
export class OpenTofuProviderSource implements ProviderSource {
  constructor(private readonly registryUrl: string = REGISTRY_URL) {}

  async resolve(opts: {
    source: string;
    version: string;
    platform: PlatformInfo;
    arch: string;
    signal?: AbortSignal;
  }): Promise<ResolvedProvider> {
    const [namespace, type] = opts.source.split('/');
    if (!namespace || !type) {
      throw new Error(`Invalid provider source: ${opts.source}`);
    }

    // Fetch download info from registry
    const downloadUrl = `${this.registryUrl}/v1/providers/${namespace}/${type}/${opts.version}/download/${opts.platform.os}/${opts.arch}`;
    const buf = await fetchBuffer({ url: downloadUrl, signal: opts.signal });
    const downloadInfo = JSON.parse(buf.toString('utf-8')) as ProviderDownloadResponse;

    if (!downloadInfo.download_url) {
      throw new Error(`No download URL for ${opts.source} ${opts.version} on ${opts.platform.os}/${opts.arch}`);
    }

    return {
      source: opts.source,
      version: opts.version,
      downloadUrl: downloadInfo.download_url,
      filename: downloadInfo.filename ?? archiveNameFor(
        `terraform-provider-${type}_${opts.version}`,
        opts.version,
        opts.platform,
      ),
      os: opts.platform.os,
      arch: opts.platform.arch,
    };
  }

  async listVersions(opts: { source: string; platform: PlatformInfo; signal?: AbortSignal }): Promise<Array<{ version: string; protocols?: string[] }>> {
    const [namespace, type] = opts.source.split('/');
    if (!namespace || !type) {
      throw new Error(`Invalid provider source: ${opts.source}`);
    }

    // 1. Fetch service discovery document
    const discoveryBuf = await fetchBuffer({ url: `${this.registryUrl}/.well-known/terraform.json`, signal: opts.signal });
    const discovery = JSON.parse(discoveryBuf.toString('utf-8')) as Record<string, string>;
    const providersBase = discovery['providers.v1'];
    if (!providersBase) {
      throw new Error('Registry does not expose a providers.v1 endpoint');
    }

    // 2. Fetch version list
    const versionsUrl = `${this.registryUrl}${providersBase}${namespace}/${type}/versions`;
    const versionsBuf = await fetchBuffer({ url: versionsUrl, signal: opts.signal });
    const versionsDoc = JSON.parse(versionsBuf.toString('utf-8')) as OpenTofuVersionsResponse;

    // 3. Filter by current platform availability
    const result: Array<{ version: string; protocols?: string[] }> = [];
    for (const v of versionsDoc.versions ?? []) {
      if (v.protocols?.length && !v.protocols.some((p: string) => p.startsWith('5.'))) continue;
      const platforms = v.platforms ?? [];
      if (platforms.length > 0 && !platforms.some((p: { os: string; arch: string }) => p.os === opts.platform.os && p.arch === opts.platform.arch)) continue;
      result.push({ version: v.version, protocols: v.protocols });
    }
    return result;
  }
}

export class OpenTofuProviderManager extends BaseProviderManager {
  constructor(opts: Partial<ProviderManagerOptions> & { source?: ProviderSource } = {}) {
    super({
      toolId: 'opentofu',
      source: opts.source ?? new OpenTofuProviderSource(),
      paths: opts.paths,
      logger: opts.logger,
      platform: opts.platform,
      providersDir: opts.providersDir,
    });
  }
}

interface OpenTofuVersionsResponse {
  versions: Array<{
    version: string;
    protocols?: string[];
    platforms?: Array<{ os: string; arch: string }>;
  }>;
}

interface ProviderDownloadResponse {
  download_url?: string;
  filename?: string;
  protocols?: string[];
  os?: string;
  arch?: string;
}
