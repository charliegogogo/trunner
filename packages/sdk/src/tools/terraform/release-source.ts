import { fetchBuffer } from '../../installer/downloader.js';
import type { PlatformInfo } from '../../utils/os.js';
import type { ReleaseEntry, ReleaseSource } from '../base/base-binary-manager.js';

const DEFAULT_BASE_URL = 'https://releases.hashicorp.com/terraform';

/**
 * HashiCorp's release source for Terraform.
 *
 * The version listing is read from the public `index.json` file shipped by
 * `releases.hashicorp.com/terraform/`. Each version has a `builds` array that
 * lists the per-platform download URLs (HashiCorp ships a single `.zip` per
 * platform, regardless of OS).
 */
export class TerraformReleaseSource implements ReleaseSource {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async listVersions(opts: { signal?: AbortSignal; limit?: number } = {}): Promise<string[]> {
    const url = `${this.baseUrl}/index.json`;
    const buf = await fetchBuffer({ url, signal: opts.signal });
    const json = JSON.parse(buf.toString('utf-8')) as IndexJson;
    const versions: string[] = [];
    for (const v of Object.keys(json.versions ?? {})) {
      // Pre-release / beta versions are not stable Terraform releases.
      if (v.includes('-')) continue;
      versions.push(v);
    }
    versions.sort(compareSemverDesc);
    return opts.limit ? versions.slice(0, opts.limit) : versions;
  }

  async resolve(opts: { version: string; platform: PlatformInfo; signal?: AbortSignal }): Promise<ReleaseEntry> {
    const { version, platform, signal } = opts;
    const url = `${this.baseUrl}/index.json`;
    const buf = await fetchBuffer({ url, signal });
    const json = JSON.parse(buf.toString('utf-8')) as IndexJson;
    const v = json.versions?.[version];
    if (!v) throw new Error(`Unknown Terraform version: ${version}`);

    // HashiCorp uses "darwin" / "linux" / "windows" and "amd64" / "arm64" / "386" / "arm".
    const build = v.builds.find(
      (b) => b.os === platform.os && b.arch === platform.arch,
    );
    if (!build) {
      throw new Error(
        `No Terraform ${version} build for ${platform.os}/${platform.arch}`,
      );
    }

    // The checksum file is "<URL>.sha256" or "<URL>.sha256sum". The API
    // exposes it as a relative file next to the binary.
    let sha256: string | undefined;
    try {
      const sumBuf = await fetchBuffer({ url: `${build.url}.sha256`, signal });
      sha256 = sumBuf.toString('utf-8').trim().split(/\s+/)[0];
    } catch {
      sha256 = undefined;
    }

    return {
      version,
      url: build.url,
      sha256,
      filename: build.filename,
      archiveFormat: 'zip',
    };
  }
}

interface IndexJson {
  versions: Record<
    string,
    {
      name: string;
      shasums: string;
      shasums_signature: string;
      shasums_signatures: string;
      version: string;
      builds: BuildEntry[];
    }
  >;
}

interface BuildEntry {
  name: string;
  version: string;
  os: string;
  arch: string;
  filename: string;
  url: string;
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
