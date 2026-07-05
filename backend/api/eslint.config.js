import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
        fetch: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'error',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-dupe-keys': 'off',
      'no-duplicate-imports': 'warn',
    },
  },
];
