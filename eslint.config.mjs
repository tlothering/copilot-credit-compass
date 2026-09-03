import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'e2e-results/**',
      'playwright-report/**',
      'test-results/**',
      'azuredeploy.json',
      'next-env.d.ts',
      '.data/**',
    ],
  },
  ...tseslint.configs.recommended,
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Constraint C6: prices live in the rate card, never in TypeScript.
    // Scoped to the code that consumes prices; lib/engine/rate-card.ts is the one
    // module allowed to name them, and lib/schemas holds unrelated band boundaries.
    files: ['lib/engine/**/*.ts', 'app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    ignores: ['lib/engine/rate-card.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=0.008], Literal[value=25000], Literal[value=0.01]',
          message:
            'Rate-card values must be read from data/rate-card.v1.json via lib/engine/rate-card.ts, never hard-coded.',
        },
      ],
    },
  },
];

export default config;
