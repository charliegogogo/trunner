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

/**
 * Plugin to replace @cdktf/hcl2json's WASM loading with our SEA-compatible shim.
 * 
 * Instead of inlining WASM as base64 (33% overhead), we:
 * 1. Replace the loadWasm function in bridge.js with inline logic
 * 2. The inline logic uses node:sea API when in SEA mode, falls back to fs.readFile in dev
 * 3. The WASM file is bundled as a SEA asset (no encoding overhead)
 */
const replaceWasmLoader: EsbuildPlugin = {
  name: 'replace-wasm-loader',
  setup(build) {
    const filter = /[\\/]@cdktf[\\/]hcl2json[\\/]lib[\\/]bridge\.js$/;
    build.onLoad({ filter }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      
      // Inline WASM loading logic that works in both SEA and non-SEA environments
      // Uses require with a string variable to avoid esbuild transforming the module name
      // The "node:" prefix must be preserved for the sea module to work
      const replacement = `const loadWasm = async () => {
    const zlib = require("zlib");
    const fs = require("fs");
    const path = require("path");
    
    // Check if running in SEA mode
    // IMPORTANT: Use a variable to prevent esbuild from transforming the module name
    const seaModuleName = "node:sea";
    let isSea = false;
    try {
        const sea = require(seaModuleName);
        isSea = sea.isSea();
    } catch {
        // node:sea not available or not in SEA mode
    }
    
    let compressedBytes;
    if (isSea) {
        // Load from SEA assets
        const sea = require(seaModuleName);
        compressedBytes = Buffer.from(sea.getAsset("main.wasm.gz"));
    } else {
        // Load from filesystem (development mode)
        compressedBytes = fs.readFileSync(path.join(__dirname, "..", "main.wasm.gz"));
    }
    
    return zlib.gunzipSync(compressedBytes);
};`;
      
      // Replace the loadWasm function
      const loadWasmPattern = /const loadWasm = async \(\) => \{[\s\S]*?return \(0, zlib_1\.gunzipSync\)\(await fs\.readFile\(\(0, path_1\.join\)\(__dirname, "\.\.", "main\.wasm\.gz"\)\)\);\s*\};/;
      
      let patched = src;
      if (loadWasmPattern.test(patched)) {
        patched = patched.replace(loadWasmPattern, replacement);
      } else {
        throw new Error(
          'replace-wasm-loader: failed to patch bridge.js — loadWasm pattern not found. ' +
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
  esbuildPlugins: [replaceWasmLoader],
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
