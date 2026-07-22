import gateway from './gateway/index.js';
import startOrderService from './services/order.service.js';
import startDriverService from './services/driver.service.js';
import logger from '../api/src/middleware/logger.js';

async function startGraphQL() {
    try {
        logger.info('🚀 Starting GraphQL Federation...');

        // Start services
        await Promise.all([
            startOrderService(),
            startDriverService(),
            // Add other services
        ]);

        // Start gateway
        await gateway.start();

        logger.info('✅ GraphQL Federation fully started');
    } catch (error) {
        logger.error('❌ GraphQL startup failed:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    await gateway.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await gateway.stop();
    process.exit(0);
});

startGraphQL();