import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function resolveLogLevel() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS.includes(level) ? level : 'info';
}

function sanitizeLogLevel(level) {
  return LOG_LEVELS.includes(level) ? level : 'info';
}

const logger = pino({
  level: resolveLogLevel(),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    },
  }),
});

export { LOG_LEVELS, sanitizeLogLevel };
export default logger;
