import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'node',
  target: 'node26',
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  shims: false,
});
