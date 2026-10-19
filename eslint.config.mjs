import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.dev-runtime/**', 'out/**', '**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  {
    files: ['electron-builder.macos-release.cjs', 'electron-builder.macos-validation.cjs', 'scripts/macos-release/*.cjs', 'scripts/opensource/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
