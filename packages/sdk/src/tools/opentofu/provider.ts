import { BaseProviderManager, type ProviderSource, type ProviderManagerOptions } from '../base/base-provider-manager.js';
import { archiveNameFor, type PlatformInfo } from '../../utils/os.js';
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
  }): Promise<ResolvedProvider> {
    const [namespace, type] = opts.source.split('/');
    if (!namespace || !type) {
      throw new Error(`Invalid provider source: ${opts.source}`);
    }
    const url = `${this.registryUrl}/v1/providers/${namespace}/${type}/${opts.version}/download/${opts.platform.os}/${opts.arch}`;
    const filename = archiveNameFor(
      `terraform-provider-${type}_${opts.version}`,
      opts.version,
      opts.platform,
    );
    return {
      source: opts.source,
      version: opts.version,
      downloadUrl: url,
      filename,
      os: opts.platform.os,
      arch: opts.platform.arch,
    };
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
