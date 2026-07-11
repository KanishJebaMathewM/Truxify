import pino from 'pino';
import { correlationContext } from './correlationId.js';

const isDev = process.env.NODE_ENV !== 'production';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

const LOG_METHODS = new Set(LOG_LEVELS);

function resolveLogLevel() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS.includes(level) ? level : 'info';
}

function sanitizeLogLevel(level) {
  return LOG_LEVELS.includes(level) ? level : 'info';
}

const rootLogger = pino({
  level: resolveLogLevel(),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    },
  }),
});

function getRequestLogger() {
  const store = correlationContext.getStore();
  if (!store?.correlationId) return null;
  if (!store._childLogger) {
    store._childLogger = rootLogger.child({ correlationId: store.correlationId });
  }
  return store._childLogger;
}

const logger = new Proxy(rootLogger, {
  get(target, prop) {
    if (LOG_METHODS.has(prop)) {
      const requestLogger = getRequestLogger();
      if (requestLogger) {
        const val = Reflect.get(requestLogger, prop);
        return typeof val === 'function' ? val.bind(requestLogger) : val;
      }
      return Reflect.get(target, prop);
    }
    if (prop === 'child') {
      return (bindings) => {
        const requestLogger = getRequestLogger();
        if (requestLogger) {
          return requestLogger.child(bindings);
        }
        return target.child(bindings);
      };
    }
    return Reflect.get(target, prop);
  },
});

export { LOG_LEVELS, sanitizeLogLevel };
export default logger;
