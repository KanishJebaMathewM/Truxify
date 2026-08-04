import * as Sentry from '@sentry/node';
import logger from '../../middleware/logger.js';

/**
 * Transaction Monitoring Service using Sentry APM
 * 
 * This service provides:
 * - Transaction tracing across distributed systems
 * - Performance monitoring
 * - Error tracking with full context
 * - Business transaction metrics
 */

class TransactionMonitor {
  constructor() {
    this.initialized = false;
    this.transactionPatterns = new Map();
  }

  /**
   * Initialize Sentry with Truxify configuration
   */
  initialize(dsn) {
    if (this.initialized) {
      logger.warn('[TransactionMonitor] Already initialized');
      return;
    }

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.APP_VERSION || '1.0.0',
      
      // Performance monitoring
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
      
      // Enable profiling (Node.js)
      profilesSampleRate: 0.1,
      
      // Custom integrations
      integrations: [
        // HTTP integration for automatic request tracing
        new Sentry.Integrations.Http({ tracing: true }),
        // Express integration
        new Sentry.Integrations.Express(),
        // PostgreSQL integration
        new Sentry.Integrations.Postgres(),
        // Redis integration
        new Sentry.Integrations.Redis(),
      ],
      
      // BeforeSend hook for filtering and data sanitization
      beforeSend: (event, hint) => {
        // Remove sensitive data before sending
        if (event.request) {
          delete event.request.headers;
          delete event.request.cookies;
        }
        return event;
      },
      
      // AfterSend hook for custom logging
      afterSend: (event, hint) => {
        logger.info(`[Sentry] Event sent: ${event.event_id}`);
      },
    });

    this.initialized = true;
    logger.info('[TransactionMonitor] Initialized with Sentry APM');
  }

  /**
   * Start a new transaction span
   */
  startTransaction(name, op = 'transaction', tags = {}) {
    const transaction = Sentry.startTransaction({
      name,
      op,
      tags,
    });

    return transaction;
  }

  /**
   * Create a child span within a transaction
   */
  startSpan(transaction, name, op = 'custom') {
    return transaction.startChild({
      op,
      description: name,
    });
  }

  /**
   * Monitor a function with automatic error tracking
   */
  async monitor(name, fn, tags = {}) {
    const span = Sentry.startTransaction({
      name,
      op: 'monitor',
      tags,
    });

    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.recordException(error);
      
      // Capture additional context
      Sentry.captureException(error, {
        extra: {
          transactionName: name,
          tags,
        },
      });
      
      throw error;
    } finally {
      span.finish();
    }
  }

  /**
   * Track a business transaction (e.g., order creation, shipment update)
   */
  trackBusinessTransaction(type, data) {
    const transaction = this.startTransaction(`biz.${type}`, 'business_transaction');
    
    // Set transaction data
    transaction.setData('transactionType', type);
    transaction.setData('data', data);
    
    // Add custom measurements
    transaction.setMeasurement(`biz.${type}.count`, 1, 'count');
    
    return {
      transaction,
      complete: (status = 'ok', extra = {}) => {
        transaction.setData('status', status);
        Object.entries(extra).forEach(([key, value]) => {
          transaction.setData(key, value);
        });
        transaction.setStatus(status === 'ok' ? 'ok' : 'error');
        transaction.finish();
      },
    };
  }

  /**
   * Monitor database query performance
   */
  async monitorQuery(query, fn) {
    const startTime = Date.now();
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      // Log slow queries
      if (duration > 100) {
        logger.warn(`[TransactionMonitor] Slow query detected: ${duration}ms`, {
          query: query.substring(0, 100),
          duration,
        });
        
        Sentry.addBreadcrumb({
          category: 'database',
          message: `Slow query: ${duration}ms`,
          data: { query: query.substring(0, 200) },
          level: 'warning',
        });
      }
      
      return result;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { query: query.substring(0, 200) },
      });
      throw error;
    }
  }

  /**
   * Monitor external API calls
   */
  async monitorExternalApi(url, method, fn) {
    const span = Sentry.startTransaction({
      name: `external.${method.toLowerCase()}`,
      op: 'http.client',
    });

    try {
      const result = await fn();
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.recordException(error);
      
      // Add URL context for debugging
      Sentry.setContext('external_api', {
        url,
        method,
        error: error.message,
      });
      
      throw error;
    } finally {
      span.finish();
    }
  }

  /**
   * Capture user context for transactions
   */
  setUser(userId, email, metadata = {}) {
    Sentry.setUser({
      id: userId,
      email,
      ...metadata,
    });
  }

  /**
   * Add custom tags to current scope
   */
  setTag(key, value) {
    Sentry.setTag(key, value);
  }

  /**
   * Add custom context
   */
  setContext(key, value) {
    Sentry.setContext(key, value);
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(message, category = 'custom', level = 'info', data = {}) {
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000,
    });
  }
}

// Export singleton instance
export default new TransactionMonitor();
