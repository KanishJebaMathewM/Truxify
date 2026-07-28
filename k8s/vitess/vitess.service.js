import mysql from 'mysql2/promise';
import logger from '../../api/src/middleware/logger.js';

class VitessService {
    constructor() {
        this.vtgateHost = process.env.VTGATE_HOST || 'vtgate.vitess.svc.cluster.local';
        this.vtgatePort = process.env.VTGATE_PORT || 3306;
        this.keyspace = process.env.VITESS_KEYSPACE || 'truxify_main';

        this.pool = null;
        this.shardCount = parseInt(process.env.VITESS_SHARD_COUNT) || 4;
        
        // Read/Write splitting
        this.readPool = null;
        this.writePool = null;

        this.initializePools();
        logger.info(`✅ Vitess Service initialized (${this.shardCount} shards)`);
    }

    async initializePools() {
        const config = {
            host: this.vtgateHost,
            port: this.vtgatePort,
            user: process.env.VITESS_USER || 'vitess',
            password: process.env.VITESS_PASSWORD || 'vitess',
            database: this.keyspace,
            connectionLimit: 20,
            queueLimit: 0
        };

        // Main pool
        this.pool = mysql.createPool(config);

        // Read pool (replica)
        this.readPool = mysql.createPool({
            ...config,
            connectionLimit: 30,
            connectTimeout: 10000
        });

        // Write pool (master)
        this.writePool = mysql.createPool({
            ...config,
            connectionLimit: 10,
            connectTimeout: 5000
        });

        logger.info('✅ Vitess connection pools initialized');
    }

    // ============ Query Routing ============

    async executeQuery(query, params = [], shardKey = null) {
        try {
            // Route to appropriate shard based on shard key
            let connection = this.pool;

            if (shardKey) {
                const shard = this.getShard(shardKey);
                connection = await this.getShardConnection(shard);
            }

            const [rows] = await connection.execute(query, params);
            return rows;
        } catch (error) {
            logger.error('Query execution failed:', error);
            throw error;
        }
    }

    async executeRead(query, params = []) {
        try {
            const [rows] = await this.readPool.execute(query, params);
            return rows;
        } catch (error) {
            logger.error('Read query failed:', error);
            throw error;
        }
    }

    async executeWrite(query, params = []) {
        try {
            const [rows] = await this.writePool.execute(query, params);
            return rows;
        } catch (error) {
            logger.error('Write query failed:', error);
            throw error;
        }
    }

    // ============ Sharding Logic ============

    getShard(key) {
        // Hash-based sharding
        const hash = this.hashString(key.toString());
        return hash % this.shardCount;
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    async getShardConnection(shard) {
        // In production: return connection to specific shard
        return this.pool;
    }

    // ============ CRUD Operations ============

    async insertOrder(orderData) {
        const shardKey = orderData.order_id;
        const query = `
            INSERT INTO orders 
            (order_id, customer_id, driver_id, status, amount, pickup_lat, pickup_lng, drop_lat, drop_lng)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            orderData.order_id,
            orderData.customer_id,
            orderData.driver_id || null,
            orderData.status || 'PENDING',
            orderData.amount,
            orderData.pickup_lat,
            orderData.pickup_lng,
            orderData.drop_lat,
            orderData.drop_lng
        ];

        return await this.executeWrite(query, params, shardKey);
    }

    async getOrder(orderId) {
        const shardKey = orderId;
        const query = `SELECT * FROM orders WHERE order_id = ?`;
        const rows = await this.executeRead(query, [orderId], shardKey);
        return rows[0] || null;
    }

    async getOrdersByCustomer(customerId, limit = 100) {
        const shardKey = customerId;
        const query = `SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?`;
        return await this.executeRead(query, [customerId, limit], shardKey);
    }

    async updateOrderStatus(orderId, status) {
        const shardKey = orderId;
        const query = `UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?`;
        return await this.executeWrite(query, [status, orderId], shardKey);
    }

    async insertDriver(driverData) {
        const shardKey = driverData.driver_id;
        const query = `
            INSERT INTO drivers 
            (driver_id, name, phone, status, rating)
            VALUES (?, ?, ?, ?, ?)
        `;
        const params = [
            driverData.driver_id,
            driverData.name,
            driverData.phone,
            driverData.status || 'AVAILABLE',
            driverData.rating || 0
        ];

        return await this.executeWrite(query, params, shardKey);
    }

    async getDriver(driverId) {
        const shardKey = driverId;
        const query = `SELECT * FROM drivers WHERE driver_id = ?`;
        const rows = await this.executeRead(query, [driverId], shardKey);
        return rows[0] || null;
    }

    async updateDriverStatus(driverId, status) {
        const shardKey = driverId;
        const query = `UPDATE drivers SET status = ?, updated_at = NOW() WHERE driver_id = ?`;
        return await this.executeWrite(query, [status, driverId], shardKey);
    }

    async insertPayment(paymentData) {
        const shardKey = paymentData.order_id;
        const query = `
            INSERT INTO payments 
            (payment_id, order_id, amount, status, method, tx_hash)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [
            paymentData.payment_id,
            paymentData.order_id,
            paymentData.amount,
            paymentData.status || 'PENDING',
            paymentData.method,
            paymentData.tx_hash || null
        ];

        return await this.executeWrite(query, params, shardKey);
    }

    async getPayment(paymentId) {
        const query = `SELECT * FROM payments WHERE payment_id = ?`;
        const rows = await this.executeRead(query, [paymentId]);
        return rows[0] || null;
    }

    // ============ Cross-Shard Queries ============

    async getOrdersAcrossShards(filters = {}) {
        // This query goes to all shards
        let query = `SELECT * FROM orders WHERE 1=1`;
        const params = [];

        if (filters.status) {
            query += ` AND status = ?`;
            params.push(filters.status);
        }
        if (filters.fromDate) {
            query += ` AND created_at >= ?`;
            params.push(filters.fromDate);
        }
        if (filters.toDate) {
            query += ` AND created_at <= ?`;
            params.push(filters.toDate);
        }
        if (filters.limit) {
            query += ` LIMIT ?`;
            params.push(filters.limit);
        }

        // In production: scatter query across shards
        return await this.executeRead(query, params);
    }

    async getAggregatedStats() {
        // Aggregate across all shards
        const query = `
            SELECT 
                COUNT(*) as total_orders,
                SUM(amount) as total_revenue,
                AVG(amount) as avg_order_value,
                COUNT(DISTINCT customer_id) as total_customers
            FROM orders
        `;
        return await this.executeRead(query);
    }

    // ============ Monitoring ============

    async getShardStats() {
        const stats = {
            totalShards: this.shardCount,
            shardUsage: {},
            totalQueries: 0,
            readQueries: 0,
            writeQueries: 0
        };

        // Get shard usage stats
        for (let i = 0; i < this.shardCount; i++) {
            stats.shardUsage[i] = {
                orders: await this.getShardOrderCount(i),
                drivers: await this.getShardDriverCount(i)
            };
        }

        return stats;
    }

    async getShardOrderCount(shard) {
        try {
            const connection = await this.getShardConnection(shard);
            const [rows] = await connection.execute('SELECT COUNT(*) as count FROM orders');
            return rows[0]?.count || 0;
        } catch {
            return 0;
        }
    }

    async getShardDriverCount(shard) {
        try {
            const connection = await this.getShardConnection(shard);
            const [rows] = await connection.execute('SELECT COUNT(*) as count FROM drivers');
            return rows[0]?.count || 0;
        } catch {
            return 0;
        }
    }

    async getQueryStats() {
        return {
            poolSize: this.pool.pool.connections.length,
            readPoolSize: this.readPool.pool.connections.length,
            writePoolSize: this.writePool.pool.connections.length,
            shardCount: this.shardCount,
            timestamp: new Date().toISOString()
        };
    }

    async closeConnections() {
        await this.pool.end();
        await this.readPool.end();
        await this.writePool.end();
        logger.info('✅ Vitess connections closed');
    }
}

export default new VitessService();