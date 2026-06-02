import { describe, expect, it } from 'vitest';
import {
  archiveNameFor,
  binaryNameFor,
  detectPlatformString,
  getPlatformInfo,
  trunnerHome,
  type PlatformInfo,
} from '../../src/utils/os.js';

describe('utils/os', () => {
  it('getPlatformInfo returns a supported platform/arch combination', () => {
    const info = getPlatformInfo();
    expect(['darwin', 'linux', 'windows']).toContain(info.os);
    expect(['amd64', 'arm64', '386', 'arm']).toContain(info.arch);
    expect(info.isWindows).toBe(info.os === 'windows');
    expect(['zip', 'tar.gz']).toContain(info.archiveExtension);
    expect(info.binaryExtension).toBe(info.isWindows ? '.exe' : '');
  });

  it('detectPlatformString returns "<os>_<arch>"', () => {
    const info = getPlatformInfo();
    expect(detectPlatformString(info)).toBe(`${info.os}_${info.arch}`);
  });

  it('binaryNameFor appends .exe only on Windows', () => {
    const win: PlatformInfo = { os: 'windows', arch: 'amd64', isWindows: true, binaryExtension: '.exe', archiveExtension: 'zip' };
    const nix: PlatformInfo = { os: 'linux', arch: 'amd64', isWindows: false, binaryExtension: '', archiveExtension: 'tar.gz' };
    expect(binaryNameFor('terraform', win)).toBe('terraform.exe');
    expect(binaryNameFor('terraform', nix)).toBe('terraform');
  });

  it('archiveNameFor uses zip on Windows, tar.gz elsewhere', () => {
    const win: PlatformInfo = { os: 'windows', arch: 'amd64', isWindows: true, binaryExtension: '.exe', archiveExtension: 'zip' };
    const nix: PlatformInfo = { os: 'darwin', arch: 'amd64', isWindows: false, binaryExtension: '', archiveExtension: 'tar.gz' };
    expect(archiveNameFor('terraform', '1.6.0', win)).toBe('terraform_1.6.0_windows_amd64.zip');
    expect(archiveNameFor('terraform', '1.6.0', nix)).toBe('terraform_1.6.0_darwin_amd64.tar.gz');
  });

  it('trunnerHome returns ~/.trunner', () => {
    const home = trunnerHome();
    expect(home).toMatch(/\.trunner$/);
  });
});
