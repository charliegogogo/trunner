#!/usr/bin/env node
// Detect host platform and dispatch to the right SEA build script.
// Used by `pnpm cli:build:sea`.
import { spawnSync } from 'node:child_process';
import { platform } from 'node:process';

const map = {
  darwin: 'cli:build:sea:macos',
  linux: 'cli:build:sea:linux',
  win32: 'cli:build:sea:windows',
};

const script = map[platform];
if (!script) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

console.log(`Dispatching to pnpm ${script}`);
const res = spawnSync('pnpm', [script], { stdio: 'inherit' });
process.exit(res.status ?? 1);
