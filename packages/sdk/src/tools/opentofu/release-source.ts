import { fetchBuffer } from '../../installer/downloader.js';
import type { PlatformInfo } from '../../utils/os.js';
import type { ReleaseEntry, ReleaseSource } from '../base/base-binary-manager.js';

const DEFAULT_BASE_URL = 'https://github.com/opentofu/opentofu/releases';

/**
 * OpenTofu release source.
 *
 * The version listing is read from the public releases API.
 * OpenTofu uses GitHub releases with tags like "v1.6.0".
 */
export class OpenTofuReleaseSource implements ReleaseSource {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async listVersions(opts: { signal?: AbortSignal; limit?: number } = {}): Promise<string[]> {
    const url = 'https://api.github.com/repos/opentofu/opentofu/releases';
    const buf = await fetchBuffer({ url, signal: opts.signal });
    const json = JSON.parse(buf.toString('utf-8')) as GitHubRelease[];
    const versions: string[] = [];
    for (const release of json) {
      const tag = release.tag_name;
      // Skip pre-release versions
      if (release.prerelease) continue;
      // Extract version from tag (e.g., "v1.6.0" -> "1.6.0")
      const version = tag.startsWith('v') ? tag.slice(1) : tag;
      versions.push(version);
    }
    versions.sort(compareSemverDesc);
    return opts.limit ? versions.slice(0, opts.limit) : versions;
  }

  async resolve(opts: { version: string; platform: PlatformInfo; signal?: AbortSignal }): Promise<ReleaseEntry> {
    const { version, platform, signal } = opts;
    // Try to find release by tag
    const tag = `v${version}`;
    const url = `${this.baseUrl}/download/${tag}/tofu_${version}_${platform.os}_${platform.arch}.zip`;
    const filename = `tofu_${version}_${platform.os}_${platform.arch}.zip`;

    return {
      version,
      url,
      filename,
      archiveFormat: 'zip',
    };
  }
}

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
}

function compareSemverDesc(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10));
  const pb = b.split('.').map((s) => Number.parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return y - x;
  }
  return 0;
}
