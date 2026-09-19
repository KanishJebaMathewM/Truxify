import logger from '../middleware/logger.js';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use environment variable for Swagger server URL
const apiUrl = process.env.API_PUBLIC_URL || 'http://localhost:5000';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Truxify Backend API',
      version: '1.0.0',
      description: 'API documentation for Truxify logistics backend',
    },
    servers: [
      {
        url: apiUrl,
        description: process.env.API_PUBLIC_URL
          ? 'Configured server'
          : 'Development server',
      },
    ],
  },
  apis: [
    path.join(__dirname, '../routes/*.js'),
    path.join(__dirname, '../../routes/*.js'),
    path.join(__dirname, '../../../zkid/routes.js'),
    path.join(__dirname, '../../../dao/routes.js'),
    path.join(__dirname, '../../../mev/routes.js'),
    path.join(__dirname, '../../../tokenization/routes.js'),
    path.join(__dirname, '../../../atomic-swap/routes.js'),
    path.join(__dirname, '../../../ebpf/routes.js'),
    path.join(__dirname, '../../../wasi/routes.js'),
    path.join(__dirname, '../../../wasm/routes.js'),
    path.join(__dirname, '../../../snyk/routes.js'),
    path.join(__dirname, '../../../database/liquibase/routes.js'),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export { swaggerSpec };

export const setupSwagger = (app) => {
  if (process.env.NODE_ENV === 'production') {
    logger.warn('[Swagger] Disabling Swagger UI in production');
    return;
  }
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
