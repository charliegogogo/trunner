import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { parse as hclParse } from '@cdktf/hcl2json';
import { BaseProviderManager, type ProviderSource, type ProviderManagerOptions } from '../base/base-provider-manager.js';
import { archiveNameFor, type PlatformInfo } from '../../utils/os.js';
import { fetchBuffer } from '../../installer/downloader.js';
import type {
  ParsedLockFile,
  ParsedRequiredProviders,
  ProviderLockEntry,
  ProviderRef,
  ResolvedProvider,
} from '../../types/provider.js';

const REGISTRY_URL = 'https://registry.terraform.io';

/**
 * Resolves provider packages via the public Terraform Registry.
 *
 * The Registry's `v1/providers/{namespace}/{type}/versions` endpoint exposes
 * the download URLs for each platform+arch combination.
 */
export class TerraformProviderSource implements ProviderSource {
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
    const downloadInfo = JSON.parse(buf.toString('utf-8')) as TerraformProviderDownloadResponse;

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
    const versionsDoc = JSON.parse(versionsBuf.toString('utf-8')) as VersionsResponse;

    // 3. Filter by current platform availability
    const result: Array<{ version: string; protocols?: string[] }> = [];
    for (const v of versionsDoc.versions ?? []) {
      if (v.protocols?.length && !v.protocols.some((p) => p.startsWith('5.'))) continue;
      const platforms = v.platforms ?? [];
      if (platforms.length > 0 && !platforms.some((p) => p.os === opts.platform.os && p.arch === opts.platform.arch)) continue;
      result.push({ version: v.version, protocols: v.protocols });
    }
    return result;
  }
}

export class TerraformProviderManager extends BaseProviderManager {
  constructor(opts: Partial<ProviderManagerOptions> & { source?: ProviderSource } = {}) {
    super({
      toolId: 'terraform',
      source: opts.source ?? new TerraformProviderSource(),
      paths: opts.paths,
      logger: opts.logger,
      platform: opts.platform,
      providersDir: opts.providersDir,
    });
  }

  /** Parse `.terraform.lock.hcl` into a typed structure. */
  async parseLockFile(filePath: string): Promise<ParsedLockFile> {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return parseLockFileString(raw);
  }

  /** Parse `required_providers` from a configuration file. */
  async parseRequiredProviders(filePath: string): Promise<ParsedRequiredProviders> {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return parseRequiredProvidersString(raw);
  }
}

/**
 * Adapter: parse HCL string content. We use @cdktf/hcl2json and shape the
 * result to our internal types.
 *
 * Output shape produced by @cdktf/hcl2json for a typical .terraform.lock.hcl:
 *   { provider: { "<source>": [ { version, hashes, ... } ] } }
 *
 * For terraform { required_providers { aws = { source, version } } }:
 *   { terraform: [ { required_providers: [ { aws: {...}, random: {...} } ] } ] }
 *
 * For top-level required_providers { ... } (newer style):
 *   { required_providers: [ { aws: {...} } ] }
 */
export async function parseLockFileString(content: string): Promise<ParsedLockFile> {
  const cleaned = content.replace(/^\uFEFF/, '');
  const json = (await hclParse('<lock>', cleaned)) as unknown;
  const root = unwrapRoot(json);
  const providers: ProviderLockEntry[] = [];

  const providerBlock = root['provider'];
  if (providerBlock && typeof providerBlock === 'object') {
    // providerBlock is { "<source>": [ { version, hashes } ] }
    for (const [source, entries] of Object.entries(providerBlock as Record<string, unknown>)) {
      const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const version = typeof e['version'] === 'string' ? (e['version'] as string) : '';
        const hashes = Array.isArray(e['hashes'])
          ? (e['hashes'] as unknown[]).filter((h): h is string => typeof h === 'string')
          : [];
        if (version) providers.push({ source, version, hashes });
      }
    }
  }
  return { providers };
}

export async function parseRequiredProvidersString(content: string): Promise<ParsedRequiredProviders> {
  const cleaned = content.replace(/^\uFEFF/, '');
  const json = (await hclParse('<config>', cleaned)) as unknown;
  const root = unwrapRoot(json);
  const providers: ProviderRef[] = [];

  // terraform { required_providers { ... } } case
  const terraformBlocks = root['terraform'];
  if (terraformBlocks) {
    const blocks = Array.isArray(terraformBlocks) ? terraformBlocks : [terraformBlocks];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const required = (block as Record<string, unknown>)['required_providers'];
      // required is an array of single-key objects, e.g. [ { aws: {...}, random: {...} } ]
      const requiredArr = Array.isArray(required) ? required : required ? [required] : [];
      for (const inner of requiredArr) {
        if (!inner || typeof inner !== 'object') continue;
        for (const [name, raw] of Object.entries(inner as Record<string, unknown>)) {
          if (!raw || typeof raw !== 'object') continue;
          const r = raw as Record<string, unknown>;
          const source = typeof r['source'] === 'string' ? (r['source'] as string) : `hashicorp/${name}`;
          const version = typeof r['version'] === 'string' ? (r['version'] as string) : undefined;
          providers.push({ source, ...(version ? { version } : {}) });
        }
      }
    }
  }

  // Top-level required_providers block (newer style).
  const top = root['required_providers'];
  if (top) {
    const blocks = Array.isArray(top) ? top : [top];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      for (const [name, raw] of Object.entries(block as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const source = typeof r['source'] === 'string' ? (r['source'] as string) : `hashicorp/${name}`;
        const version = typeof r['version'] === 'string' ? (r['version'] as string) : undefined;
        if (!providers.find((p) => p.source === source)) {
          providers.push({ source, ...(version ? { version } : {}) });
        }
      }
    }
  }

  return { providers };
}

function unwrapRoot(parsed: unknown): Record<string, unknown> {
  if (Array.isArray(parsed)) {
    // @cdktf/hcl2json returns an array of top-level blocks; merge them
    // into a single object keyed by block name. We take only the *first*
    // occurrence of each block name (subsequent ones are treated as
    // additional instances of the same block, which we handle below).
    const merged: Record<string, unknown> = {};
    for (const block of parsed) {
      if (!block || typeof block !== 'object') continue;
      for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
        const existing = merged[k];
        if (existing === undefined) {
          merged[k] = v;
        } else if (Array.isArray(existing) && Array.isArray(v)) {
          merged[k] = [...existing, ...v];
        } else if (Array.isArray(existing)) {
          merged[k] = [...existing, v];
        } else if (Array.isArray(v)) {
          merged[k] = [existing, ...v];
        } else {
          merged[k] = [existing, v];
        }
      }
    }
    return merged;
  }
  if (parsed && typeof parsed === 'object') {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/** Test helper: join base dir + provider plugin path. */
export function providerBinaryPath(baseDir: string, source: string, version: string): string {
  return join(baseDir, 'plugins', 'registry.terraform.io', source, version);
}

interface VersionsResponse {
  versions: Array<{
    version: string;
    protocols?: string[];
    platforms?: Array<{ os: string; arch: string }>;
  }>;
}

interface TerraformProviderDownloadResponse {
  download_url?: string;
  filename?: string;
  protocols?: string[];
  os?: string;
  arch?: string;
}
