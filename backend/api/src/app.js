import express from 'express';
import {
  timeoutMiddleware,
  vrpTimeoutMiddleware,
  demandHeatmapTimeoutMiddleware,
  slowRequestLoggerMiddleware,
  timeoutErrorHandler,
  logSlowRequest
} from './middleware/timeout.js';
import logger from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Track request start time for latency calculations
app.use((req, res, next) => {
  req._startTime = Date.now();
  next();
});

// 1. Slow requests monitor (>10s) logging to MongoDB slow_requests collection
app.use(slowRequestLoggerMiddleware);

// 2. Per-route overrides for known slow endpoints:
// - /api/ml/vrp -> 120s (fleet optimisation)
// - /api/ml/demand-heatmap -> 60s
app.use('/api/ml/vrp', vrpTimeoutMiddleware);
app.use('/api/ml/demand-heatmap', demandHeatmapTimeoutMiddleware);

// 3. Global timeout middleware (30s default for all other routes)
app.use(timeoutMiddleware);

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Known slow ML endpoints with per-route timeouts
app.all('/api/ml/vrp', async (req, res, next) => {
  if (req.timedout) return;
  res.status(200).json({
    success: true,
    route: '/api/ml/vrp',
    timeout: '120s',
    message: 'Fleet optimisation solver completed'
  });
});

app.all('/api/ml/demand-heatmap', async (req, res, next) => {
  if (req.timedout) return;
  res.status(200).json({
    success: true,
    route: '/api/ml/demand-heatmap',
    timeout: '60s',
    message: 'Demand heatmap calculated'
  });
});

// Catch-all timeout error handler
app.use(timeoutErrorHandler);

// Generic error handler
app.use(errorHandler);

export default app;
export { app };
