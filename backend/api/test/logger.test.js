import logger from '../src/middleware/logger.js';

logger.info({
  authorization: 'Bearer abc123',
  password: 'secret',
  apiKey: 'xyz',
});
