import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['dist', 'node_modules'],
  },
});
