import js from '@eslint/js';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

const forbiddenSolanaImport = '@solana/web3.js';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/target/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    'packages/solana/src/program/**',
  ]),
  js.configs.recommended,
  typescriptEslint.configs.strictTypeChecked,
  typescriptEslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: forbiddenSolanaImport,
              message: 'Use @solana/kit and the @solana-program packages instead.',
            },
          ],
          patterns: [
            {
              group: [`${forbiddenSolanaImport}/*`],
              message: 'Use @solana/kit and the @solana-program packages instead.',
            },
          ],
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'id-length': ['error', { min: 2, properties: 'never' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    // Build tooling and test runner configuration sit outside the compiled projects.
    files: ['**/*.config.ts', '**/*.config.mjs', '**/build.mjs', 'eslint.config.mjs'],
    extends: [typescriptEslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: false } },
  },
  {
    // Command line entry points report what they did.
    files: [
      'scripts/**/*.ts',
      'apps/keeper/src/**/*.ts',
      'apps/rescue/build.mjs',
      'packages/db/src/migrate.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // Drizzle column builders return deep generic types that cannot be written by hand.
    files: ['packages/db/src/schema/columnTypes.ts'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettierConfig,
]);
