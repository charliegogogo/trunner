export interface ProviderRef {
  source: string;
  version?: string;
}

export interface ProviderLockEntry extends ProviderRef {
  version: string;
  hashes: string[];
}

export interface ParsedLockFile {
  providers: ProviderLockEntry[];
}

export interface ParsedRequiredProviders {
  providers: ProviderRef[];
}

export interface ResolvedProvider extends ProviderRef {
  version: string;
  downloadUrl: string;
  filename: string;
  sha256Sum?: string;
  os: 'darwin' | 'linux' | 'windows';
  arch: 'amd64' | 'arm64' | '386' | 'arm';
}
