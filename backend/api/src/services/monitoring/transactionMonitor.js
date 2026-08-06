import * as Sentry from '@sentry/node';
import logger from '../../middleware/logger.js';

/**
 * Transaction Monitoring Service using Sentry APM
 * Provides transaction tracing, performance monitoring, and error tracking
 */
class TransactionMonitor {
  constructor() {
    this.initialized = false;
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
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
      profilesSampleRate: 0.1,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express(),
        new Sentry.Integrations.Postgres(),
        new Sentry.Integrations.Redis(),
      ],
      beforeSend: (event) => {
        if (event.request) {
          delete event.request.headers;
          delete event.request.cookies;
        }
        return event;
      },
    });

    this.initialized = true;
    logger.info('[TransactionMonitor] Initialized with Sentry APM');
  }

  /**
   * Start a new transaction span
   */
  startTransaction(name, op = 'transaction', tags = {}) {
    return Sentry.startTransaction({ name, op, tags });
  }

  /**
   * Create a child span within a transaction
   */
  startSpan(transaction, name, op = 'custom') {
    return transaction.startChild({ op, description: name });
  }

  /**
   * Monitor a function with automatic error tracking
   */
  async monitor(name, fn, tags = {}) {
    const span = Sentry.startTransaction({ name, op: 'monitor', tags });

    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.recordException(error);
      Sentry.captureException(error, { extra: { transactionName: name, tags } });
      throw error;
    } finally {
      span.finish();
    }
  }

  /**
   * Track a business transaction
   */
  trackBusinessTransaction(type, data) {
    const transaction = this.startTransaction(`biz.${type}`, 'business_transaction');
    transaction.setData('transactionType', type);
    transaction.setData('data', data);
    transaction.setMeasurement(`biz.${type}.count`, 1, 'count');
    
    return {
      transaction,
      complete: (status = 'ok', extra = {}) => {
        transaction.setData('status', status);
        Object.entries(extra).forEach(([key, value]) => transaction.setData(key, value));
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
      if (duration > 100) {
        logger.warn(`[TransactionMonitor] Slow query: ${duration}ms`, { query: query.substring(0, 100), duration });
        Sentry.addBreadcrumb({ category: 'database', message: `Slow query: ${duration}ms`, level: 'warning' });
      }
      return result;
    } catch (error) {
      Sentry.captureException(error, { extra: { query: query.substring(0, 200) } });
      throw error;
    }
  }

  setUser(userId, email, metadata = {}) {
    Sentry.setUser({ id: userId, email, ...metadata });
  }

  setTag(key, value) {
    Sentry.setTag(key, value);
  }

  setContext(key, value) {
    Sentry.setContext(key, value);
  }

  addBreadcrumb(message, category = 'custom', level = 'info', data = {}) {
    Sentry.addBreadcrumb({ message, category, level, data, timestamp: Date.now() / 1000 });
  }
}

export default new TransactionMonitor();
