import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['coverage/**', 'src/services/documentService.js', 'src/services/locationService.js', 'src/services/r2StorageService.js', 'src/services/voiceAiService.js', 'src/services/wallet/walletService.js', 'src/utils/escrowValidator.js', 'test/unit/trafficService.test.js', 'test/changeDrop.escrowRebalance.test.js'] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
        fetch: 'readonly',
        __ENV: 'readonly',
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
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        vi: 'writable',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        test: 'readonly',
      }
    },
  },
];
