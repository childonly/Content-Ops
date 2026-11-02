import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.playwright-browsers/**', '**/data/**', '**/logs/**', '**/uploads/**', '**/.venv/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } } },
  {
    languageOptions: { globals: Object.fromEntries(['process','Buffer','__dirname','require','module','exports','console','setTimeout','clearTimeout','setInterval','clearInterval','fetch','URL','Blob','window','document','navigator','localStorage','AbortController','AbortSignal'].map(name => [name, 'readonly'])) },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/ban-ts-comment': 'off',
      'prefer-const': 'warn', 'no-empty': ['error', { allowEmptyCatch: true }],
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },
  { files: ['**/*.{ts,vue}'], rules: { 'no-undef': 'off' } },
  { files: ['scripts/**/*.js', 'scripts/**/*.cjs'], languageOptions: { globals: { __filename: 'readonly' } } },
];
