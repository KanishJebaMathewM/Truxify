import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'coverage/**',
      'src/services/documentService.js',
      'src/services/locationService.js',
      'src/services/r2StorageService.js',
      'src/services/voiceAiService.js',
      'src/services/wallet/walletService.js',
      'src/utils/escrowValidator.js',
      'test/unit/trafficService.test.js',
      'test/changeDrop.escrowRebalance.test.js',
      'test/unit/audioValidation.test.js',
      'test/unit/escrowWebhookGuards.test.js',
      'test/unit/fraudDetectionService.pagination.test.js',
      'test/unit/fraudDetectionServiceGuard.test.js',
      'test/unit/lib/redisLock.test.js',
      'test/unit/profileService.test.js',
      'test/unit/redisLock.test.js',
    ]
  },
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
