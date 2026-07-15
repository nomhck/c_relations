/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'playwright.config.ts', 'vite.config.ts'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // §7.4: ストア直接変更禁止の担保。ストア外からの set() 直呼びやアクション迂回を抑止する足場。
    // 本格的な no-restricted-imports ルールは storage/api 導入時に強化する。
    'no-restricted-syntax': [
      'warn',
      {
        selector: "MemberExpression[object.name='useApp'][property.name='setState']",
        message: 'ストアの直接 setState は禁止。定義済みアクション経由で状態を更新してください（§7.4）。',
      },
    ],
  },
};
