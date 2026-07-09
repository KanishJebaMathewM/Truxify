import logger from '../middleware/logger.js';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// Use environment variable for Swagger server URL
const apiUrl = process.env.API_PUBLIC_URL || 'http://localhost:5000/api';

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
  apis: ['./src/routes/*.js'], // files containing annotations as above
};

const swaggerSpec = swaggerJsdoc(options);

export const setupSwagger = (app) => {
  if (process.env.NODE_ENV === 'production') {
    logger.warn('[Swagger] Disabling Swagger UI in production');
    return;
  }
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
