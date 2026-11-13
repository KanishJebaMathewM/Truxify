import { vi } from 'vitest';
vi.mock('../src/core/retry.js', () => ({ executeWithRetry: fn => fn(), isRetryable: () => false }));
vi.mock('../src/core/performanceMetrics.js', () => ({ measureExecution: (_name, fn) => fn() }));
vi.mock('../src/lib/requestContext.js', () => ({ getRequestCache: () => null }));
vi.mock('../src/utils/pagination.js', () => ({ buildPagination: () => ({}) }));
