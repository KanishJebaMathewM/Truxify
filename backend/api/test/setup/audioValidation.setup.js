/**
 * Audio Validation Test Setup
 * 
 * Configures the Vitest environment for audio validation tests,
 * ensuring consistent global mocks and cleanup.
 */
import { vi, beforeEach, afterEach } from 'vitest';

// Ensure Buffer is globally available and behaves predictably
beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// Mock any external dependencies if audioValidation.js imports them in the future
vi.mock('../../src/middleware/logger.js', () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));
