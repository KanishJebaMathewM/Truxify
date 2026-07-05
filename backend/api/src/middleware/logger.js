import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const isDev = process.env.NODE_ENV !== 'production';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function resolveLogLevel() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS.includes(level) ? level : 'info';
}

function sanitizeLogLevel(level) {
  return LOG_LEVELS.includes(level) ? level : 'info';
}

export const asyncLocalStorage = new AsyncLocalStorage();

const logger = pino({
  level: resolveLogLevel(),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    },
  }),
  mixin() {
    const store = asyncLocalStorage.getStore();
    if (store && store.requestId) {
      return { requestId: store.requestId };
    }
    return {};
  }
});

export { LOG_LEVELS, sanitizeLogLevel };
export default logger;
