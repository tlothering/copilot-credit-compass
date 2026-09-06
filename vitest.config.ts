import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'node',
    // The invariant and export suites do real work — a few hundred full engine runs, and
    // PDF/XLSX/PPTX writes. The heaviest sat at ~5.04s against Vitest's 5s default and so
    // failed intermittently under coverage instrumentation, which is slower still. A flaky
    // gate is worse than a slow one: it trains you to re-run rather than to read.
    testTimeout: 60_000,
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
