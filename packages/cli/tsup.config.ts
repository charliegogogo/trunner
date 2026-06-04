import { defineConfig } from 'tsup';

const stub = 'data:text/javascript,export default {};';

export default defineConfig({
  entry: ['src/trunner.tsx'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node26',
  platform: 'node',
  bundle: true,
  external: ['postject', '@cdktf/hcl2json', '@cdktf/hcl2json/*', 'tar', 'tar/*', 'adm-zip', 'adm-zip/*'],
  noExternal: [/.+/],
  minify: true,
  sourcemap: true,
  clean: true,
  shims: false,
  splitting: false,
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
