import { arch, homedir, platform } from 'node:os';

export type SupportedPlatform = 'darwin' | 'linux' | 'windows';
export type SupportedArch = 'amd64' | 'arm64' | '386' | 'arm';

export interface PlatformInfo {
  os: SupportedPlatform;
  arch: SupportedArch;
  isWindows: boolean;
  binaryExtension: string;
  archiveExtension: 'zip' | 'tar.gz';
}

const NODEJS_TO_GO_OS: Partial<Record<NodeJS.Platform, SupportedPlatform>> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
  cygwin: 'windows',
};

const NODEJS_TO_ARCH: Record<string, SupportedArch> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
  arm: 'arm',
};

export function getPlatformInfo(): PlatformInfo {
  const nodeOs = platform();
  const os = NODEJS_TO_GO_OS[nodeOs];
  const nodeArch = arch();
  const a = NODEJS_TO_ARCH[nodeArch];
  if (!os || !a) {
    throw new Error(`Unsupported platform/arch: ${nodeOs}/${nodeArch}`);
  }
  const isWindows = os === 'windows';
  return {
    os,
    arch: a,
    isWindows,
    binaryExtension: isWindows ? '.exe' : '',
    archiveExtension: isWindows ? 'zip' : 'tar.gz',
  };
}

export function detectPlatformString(info: PlatformInfo): string {
  return `${info.os}_${info.arch}`;
}

export function binaryNameFor(base: string, info: PlatformInfo): string {
  return `${base}${info.binaryExtension}`;
}

export function archiveNameFor(base: string, version: string, info: PlatformInfo): string {
  const platformStr = detectPlatformString(info);
  return `${base}_${version}_${platformStr}.${info.archiveExtension}`;
}

export function trunnerHome(): string {
  return `${homedir()}/.trunner`;
}
