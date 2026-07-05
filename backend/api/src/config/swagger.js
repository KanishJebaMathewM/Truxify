import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

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
        url: process.env.API_PUBLIC_URL || 'http://localhost:5000/api',
        description: process.env.API_PUBLIC_URL ? 'Server' : 'Development server',
      },
    ],
  },
  apis: ['./src/routes/*.js'], // files containing annotations as above
};

const swaggerSpec = swaggerJsdoc(options);

export const setupSwagger = (app) => {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
