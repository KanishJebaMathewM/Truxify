const { getPool } = require('../../../src/config/db');

describe('Database Configuration Unit Tests', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should create a connection pool successfully', () => {
        const pool = getPool();
        expect(pool).toBeDefined();
    });

    test('should reuse the existing pool instance (pool reuse)', () => {
        const pool1 = getPool();
        const pool2 = getPool();
        expect(pool1).toBe(pool2);
    });

    test('should have a working query method', async () => {
        const pool = getPool();
        expect(typeof pool.query).toBe('function');
    });

    test('should handle connection error propagation properly', async () => {
        // Add test logic for error handling if applicable to your setup
    });
});
