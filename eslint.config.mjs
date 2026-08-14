import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/cdk.out/**',
      '**/.next/**',
      '**/coverage/**',
      'mobile/**', // Dart — linted by `flutter analyze`, not ESLint
      'shared/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      complexity: ['warn', 10],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Test files accumulate many independent `it()` cases inside one `describe`
    // block by nature — that's breadth of coverage, not the kind of nested
    // control-flow complexity max-lines-per-function exists to catch in
    // application code. complexity/max-depth still apply within each test body.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
);
