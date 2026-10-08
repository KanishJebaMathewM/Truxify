/**
 * @fileoverview Redis mock factory for testing redisLock behavior
 * when redisClient is null, undefined, or in various states.
 */

/**
 * Creates a mock Redis client that simulates various states.
 */
export function createMockRedisClient(options = {}) {
    const {
        status = 'ready',
        setBehavior = 'OK',
        delBehavior = 1,
        evalBehavior = 1,
        shouldThrow = false,
        errorMessage = 'Mock Redis error',
    } = options;

    const store = new Map();

    return {
        status,
        isOpen: status === 'ready',

        async set(key, value, ...args) {
            if (shouldThrow) throw new Error(errorMessage);
            store.set(key, value);
            return setBehavior;
        },

        async get(key) {
            if (shouldThrow) throw new Error(errorMessage);
            return store.get(key) || null;
        },

        async del(...keys) {
            if (shouldThrow) throw new Error(errorMessage);
            let count = 0;
            for (const key of keys) {
                if (store.delete(key)) count++;
            }
            return delBehavior;
        },

        async eval(script, numKeys, ...args) {
            if (shouldThrow) throw new Error(errorMessage);
            return evalBehavior;
        },

        duplicate() {
            return createMockRedisClient(options);
        },

        on(event, callback) {
            // No-op for testing
        },
    };
}

/**
 * Creates a null-like redis client (simulates redisClient being null).
 */
export function createNullRedisClient() {
    return null;
}

/**
 * Creates a disconnected redis client.
 */
export function createDisconnectedRedisClient() {
    return {
        status: 'end',
        isOpen: false,
        async set() { throw new Error('Connection is closed'); },
        async get() { throw new Error('Connection is closed'); },
        async del() { throw new Error('Connection is closed'); },
        async eval() { throw new Error('Connection is closed'); },
    };
}

/**
 * Creates a connecting redis client (not yet ready).
 */
export function createConnectingRedisClient() {
    return {
        status: 'connecting',
        isOpen: false,
        async set() { throw new Error('Still connecting'); },
        async get() { throw new Error('Still connecting'); },
        async del() { throw new Error('Still connecting'); },
        async eval() { throw new Error('Still connecting'); },
    };
}

/**
 * Creates a mock client that always fails operations.
 */
export function createFailingRedisClient(error = 'Redis operation failed') {
    return createMockRedisClient({
        status: 'ready',
        shouldThrow: true,
        errorMessage: error,
    });
}

/**
 * Simulates Redis being completely unavailable (module not loaded).
 */
export function simulateRedisUnavailable() {
    return {
        redisClient: null,
        redisSubClient: null,
    };
}
