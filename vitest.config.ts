import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/export/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['lib/engine/**/*.ts'],
      exclude: ['lib/engine/**/*.test.ts', 'lib/engine/types.ts'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
});
