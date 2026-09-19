import logger from '../middleware/logger.js';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use environment variable for Swagger server URL
const apiUrl = process.env.API_PUBLIC_URL || 'http://localhost:5000/api';

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
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
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
