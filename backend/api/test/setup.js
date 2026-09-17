/**
 * Vitest global setup — runs once before any test file.
 *
 * Set environment variables needed by the routes under test BEFORE the
 * route modules are imported. (The auth middleware reads BYPASS_AUTH at
 * request time, but we set it eagerly so any module-level branches see
 * the bypassed state too.)
 */

// Required by auth.js middleware to read x-user-id/x-user-role headers
// directly from the request instead of verifying a Firebase token.
process.env.BYPASS_AUTH = 'true';
// Explicit opt-in for the header-based test bypass. It is independent of
// NODE_ENV and only ever set here (the dedicated test harness) so a stray
// NODE_ENV=test deployment can never impersonate users.
process.env.ENABLE_TEST_AUTH = 'true';
process.env.DEV_ACCESS_TOKEN = 'test-dev-token-123';
process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
process.env.ESCROW_MATIC_PER_PAISA = '0.000004';
process.env.MAX_ESCROW_MATIC = '10000';
process.env.DRIVER_LOGIN_OTP = '1234';

// Suppress noisy console.error output from the routes — they log
// pricing errors and DB failures to stderr when tests trigger them.
// We still fail the test if the response status is wrong.
const originalError = console.error;
console.error = (...args) => {
  const msg = args[0];
  if (typeof msg === 'string' && (
    msg.startsWith('Pricing computation error') ||
    msg.startsWith('Order Insertion Error') ||
    msg.startsWith('Load Offer Insertion Error') ||
    msg.startsWith('Timeline Insertion Error') ||
    msg.startsWith('Auth verification error')
  )) {
    return;
  }
  originalError(...args);
};

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { default: RedisMock } = await import('./mocks/redisMock.js');

global.mockRedis = new RedisMock();

beforeEach(() => {
  global.mockRedis.clear();
  vi.clearAllMocks();
});

afterAll(() => {
  global.mockRedis.clear();
});

vi.mock('mongoose', () => ({
  default: {
    connection: { readyState: 0 },
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
  connection: { readyState: 0 },
  disconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('mongodb', () => ({
  MongoClient: class {
    connect() { return Promise.resolve(this); }
    close() { return Promise.resolve(); }
    db() {
      return {
        collection: () => ({
          createIndex: vi.fn().mockResolvedValue('index_name'),
        }),
      };
    }
  },
}));

vi.mock('redis', () => {
  return {
    createClient: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      set: vi.fn((...args) => global.mockRedis.set(...args)),
      get: vi.fn((...args) => global.mockRedis.get(...args)),
      del: vi.fn((...args) => global.mockRedis.del(...args)),
      eval: vi.fn((...args) => global.mockRedis.eval(...args)),
      on: vi.fn(),
    })),
  };
});
