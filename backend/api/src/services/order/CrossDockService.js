import logger from '../../middleware/logger.js';

// Internal constant (unexported to prevent leakage in public API)
const CROSS_DOCK_STATUSES = ['PENDING', 'IN_TRANSIT', 'CROSS_DOCKED', 'COMPLETED', 'CANCELLED'];

export class CrossDockService {
  /**
   * Processes and validates cross-dock order statuses.
   */
  async processCrossDockOrder(orderId, status) {
    if (!CROSS_DOCK_STATUSES.includes(status)) {
      logger.warn(
        { orderId, status },
        '[cross-dock-service] Invalid or unsupported cross-dock status provided'
      );
      throw new Error(`Invalid cross-dock status: ${status}`);
    }

    logger.info(
      { orderId, status },
      '[cross-dock-service] Cross-dock order processed successfully'
    );

    return {
      orderId,
      status,
      processedAt: new Date().toISOString(),
    };
  }
}

export default new CrossDockService();
