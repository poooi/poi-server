import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
  },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['eslint.config.mjs'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },
  prettierRecommended,
)
