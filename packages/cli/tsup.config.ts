import { defineConfig } from 'tsup';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const stub = 'data:text/javascript,export default {};';
const requireFromConfig = createRequire(import.meta.url);
const sdkRequire = createRequire(requireFromConfig.resolve('@trunner/sdk'));

interface EsbuildPlugin {
  name: string;
  setup(build: {
    onLoad(
      opts: { filter: RegExp; namespace?: string },
      cb: (args: { path: string }) => Promise<{ contents: string; loader: 'js' }>,
    ): void;
  }): void;
}

const inlineHcl2jsonWasm: EsbuildPlugin = {
  name: 'inline-hcl2json-wasm',
  setup(build) {
    const filter = /[\\/]@cdktf[\\/]hcl2json[\\/]lib[\\/]bridge\.js$/;
    build.onLoad({ filter }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const wasmAbsPath = sdkRequire.resolve('@cdktf/hcl2json/main.wasm.gz');
      const wasm = await readFile(wasmAbsPath);
      const b64 = wasm.toString('base64');
      const replacement = `Buffer.from(${JSON.stringify(b64)}, 'base64')`;
      const patterns = [
        /(?:[\w$]+\.)?readFile\([\s\S]*?main\.wasm\.gz[\s\S]*?\)\)/,
      ];
      let patched = src;
      for (const pattern of patterns) {
        if (pattern.test(patched)) {
          patched = patched.replace(pattern, replacement);
          break;
        }
      }
      if (patched === src) {
        throw new Error(
          'inline-hcl2json-wasm: failed to patch bridge.js — none of the known patterns matched. ' +
          'Check whether @cdktf/hcl2json updated its WASM loading strategy.',
        );
      }
      return { contents: patched, loader: 'js' };
    });
  },
};

export default defineConfig({
  entry: ['src/trunner.tsx'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node26',
  platform: 'node',
  bundle: true,
  noExternal: [/.*/],
  minify: true,
  sourcemap: true,
  clean: true,
  shims: false,
  splitting: false,
  esbuildPlugins: [inlineHcl2jsonWasm],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.banner = {
      js: `#!/usr/bin/env node
import { createRequire as __trunnerCreateRequire } from 'module';
import { fileURLToPath as __trunnerFileURLToPath } from 'url';
import { dirname as __trunnerDirname } from 'path';
const require = __trunnerCreateRequire(import.meta.url);
const __filename = __trunnerFileURLToPath(import.meta.url);
const __dirname = __trunnerDirname(__filename);
`,
    };
    options.alias = {
      'react-devtools-core': stub,
      performance: stub,
    };
  },
  onSuccess: 'node -e "require(\'fs\').chmodSync(\'dist/trunner.mjs\', 0o755)"',
});
