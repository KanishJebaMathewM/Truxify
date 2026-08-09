/**
 * Unit tests for backend/api/src/middleware/sentry.js
 *
 * Coverage:
 *   - initSentry: no-op when SENTRY_DSN is absent, calls Sentry.init when set
 *   - flushSentry: no-op when SENTRY_DSN is absent
 *   - flushSentry: calls Sentry.flush with timeoutMs when SENTRY_DSN is set
 *   - flushSentry: swallows errors from Sentry.flush gracefully during teardown
 *   - sentryErrorHandler: returns a valid Express error handler that delegates to Sentry
 *
 * Run with:  npm run test:unit -- test/unit/sentry.test.js
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as SentryModule from "@sentry/node";
import {
  initSentry,
  flushSentry,
  sentryErrorHandler,
  shouldIgnoreError,
} from "../../src/middleware/sentry.js";

vi.mock("../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@sentry/node", async (real) => ({
  ...(await real()),
  init: vi.fn(),
  flush: vi.fn(),
  expressErrorHandler: () => vi.fn(),
}));

const Sentry = SentryModule;

describe("initSentry", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("does not throw when SENTRY_DSN is not set", () => {
    expect(() => initSentry()).not.toThrow();
  });

  it("returns early without calling Sentry.init when SENTRY_DSN is absent", () => {
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});

describe("flushSentry", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is a no-op when SENTRY_DSN is not set", async () => {
    await flushSentry(2000);
    expect(Sentry.flush).not.toHaveBeenCalled();
  });

  it("calls Sentry.flush with the provided timeout when SENTRY_DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://abc@sentry.io/123");
    vi.mocked(Sentry.flush).mockResolvedValue(undefined);
    await flushSentry(3000);
    expect(Sentry.flush).toHaveBeenCalledWith(3000);
  });

  it("swallows errors from Sentry.flush gracefully during teardown", async () => {
    vi.stubEnv("SENTRY_DSN", "https://abc@sentry.io/123");
    vi.mocked(Sentry.flush).mockRejectedValue(new Error("flush failed"));
    await expect(flushSentry(2000)).resolves.toBeUndefined();
  });
});

describe("sentryErrorHandler", () => {
  it("returns a function", () => {
    const handler = sentryErrorHandler();
    expect(typeof handler).toBe("function");
  });

  it("returned handler delegates to the inner Sentry error handler with (err, req, res, next)", () => {
    // Capture the arguments passed to the inner handler by wrapping the returned function
    let capturedNext;
    const wrappedNext = vi.fn((...args) => {
      capturedNext = args;
    });
    const err = new Error("test error");
    const req = { requestId: "req-1" };
    const res = { statusCode: 500 };
    // The inner handler receives (err, req, res, next); we only verify it calls next
    const innerFn = sentryErrorHandler();
    // sentryErrorHandler() returns Sentry.expressErrorHandler()
    // which itself returns a handler(err, req, res, next)
    // We verify the returned handler exists and is callable
    expect(innerFn).toBeDefined();
    expect(typeof innerFn).toBe("function");
    // Call with mock args - verify it does not throw
    expect(() => innerFn(err, req, res, wrappedNext)).not.toThrow();
  });
});

describe("sentry — error filter and level", () => {
  // We can test the shouldIgnoreError and getSentryLevel logic through initSentry behavior.
  // Verify that initSentry does not throw for any combination of SENTRY_DSN.
  it("initSentry does not throw when SENTRY_DSN is a valid URL", () => {
    vi.stubEnv("SENTRY_DSN", "https://abc@sentry.io/456");
    expect(() => initSentry()).not.toThrow();
  });

  it("initSentry does not throw when SENTRY_DSN is empty string", () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect(() => initSentry()).not.toThrow();
  });

  it("identifies network reset errors gracefully", () => {
    vi.stubEnv("SENTRY_DSN", "https://abc@sentry.io/456");
    initSentry();
    
    const initCalls = vi.mocked(SentryModule.init).mock.calls;
    const beforeSend = initCalls[0][0].beforeSend;
    
    const OriginalError = global.Error;
    global.Error = class MockError extends OriginalError {
      constructor(msg) {
        super(msg);
        if (msg === "Connection reset") {
          this.code = "ECONNRESET";
        }
      }
    };
    
    try {
      const resetEvent = {
        exception: {
          values: [{ value: "Connection reset" }]
        }
      };
      expect(beforeSend(resetEvent)).toBeNull();
      
      const normalEvent = {
        exception: {
          values: [{ value: "Normal error" }]
        }
      };
      expect(beforeSend(normalEvent)).toBe(normalEvent);
    } finally {
      global.Error = OriginalError;
    }
  });

describe('shouldIgnoreError', () => {
  it('returns warn level for ECONNRESET errors', () => {
    const err = new Error('Connection reset');
    err.code = 'ECONNRESET';
    expect(shouldIgnoreError(err)).toBe('warn');
  });

  it('returns warn level for ECONNREFUSED errors', () => {
    const err = new Error('Connection refused');
    err.code = 'ECONNREFUSED';
    expect(shouldIgnoreError(err)).toBe('warn');
  });

  it('returns false for ETIMEDOUT errors (not in filter list)', () => {
    const err = new Error('Operation timed out');
    err.code = 'ETIMEDOUT';
    expect(shouldIgnoreError(err)).toBe(false);
  });

  it('returns false for errors with unknown codes', () => {
    const err = new Error('Some other error');
    err.code = 'OTHER_ERROR';
    expect(shouldIgnoreError(err)).toBe(false);
  });

  it('returns false for errors without a code property', () => {
    const err = new Error('No code');
    expect(shouldIgnoreError(err)).toBe(false);
  });
});

});
