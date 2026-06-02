import { join } from 'node:path';
import { trunnerHome } from '../utils/os.js';
import { ensureDir, exists } from '../utils/fs.js';

export interface TrunnerPaths {
  home: string;
  binaries: string;
  cache: string;
  downloads: string;
  providers: string;
  config: string;
  configFile: string;
  logs: string;
  tmp: string;
}

export function getPaths(home: string = trunnerHome()): TrunnerPaths {
  return {
    home,
    binaries: join(home, 'binaries'),
    cache: join(home, 'cache'),
    downloads: join(home, 'downloads'),
    providers: join(home, 'providers'),
    config: join(home, 'config'),
    configFile: join(home, 'config', 'config.json'),
    logs: join(home, 'logs'),
    tmp: join(home, 'tmp'),
  };
}

export async function ensurePaths(paths: TrunnerPaths = getPaths()): Promise<TrunnerPaths> {
  await Promise.all([
    ensureDir(paths.home),
    ensureDir(paths.binaries),
    ensureDir(paths.cache),
    ensureDir(paths.downloads),
    ensureDir(paths.providers),
    ensureDir(paths.config),
    ensureDir(paths.logs),
    ensureDir(paths.tmp),
  ]);
  return paths;
}

export async function pathExists(path: string): Promise<boolean> {
  return exists(path);
}
