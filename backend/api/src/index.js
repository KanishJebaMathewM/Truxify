import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { closeDbConnections } from './config/db.js';
import { closeWebSocketServer, initWebSocketServer } from './sockets/tracker.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import supportRoutes from './routes/supportRoutes.js';

// Configuration load from root folder is handled in db.js


const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1); // ← add this

// Enable CORS only for explicitly allowed frontend origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => {
    if (!origin) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  });

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser/same-origin requests with no Origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // In development/testing, allow localhost or loopback origins
    if (process.env.NODE_ENV !== 'production') {
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocalhost) return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-user-name']
}));

app.use(express.json());

// ============================================================================
// RATE LIMITING
// ============================================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.originalUrl === '/api/health',
  message: { error: 'Too many requests, please try again later.' }
});

const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Health check rate limit exceeded.' }
});

app.use('/api/', limiter);
app.use('/api/health', healthLimiter);



// ============================================================================
// REQUEST LOGGER
// ============================================================================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const color = res.statusCode >= 500 ? '\x1b[31m'
                : res.statusCode >= 400 ? '\x1b[33m'
                : res.statusCode >= 200 ? '\x1b[32m' : '\x1b[0m';
    console.log(
      `${color}[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)\x1b[0m`
    );
  });
  next();
});

// ============================================================================
// REST API ROUTING
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    service: 'Truxify API',
    uptime: process.uptime(),
    env: {
      bypass_auth: process.env.BYPASS_AUTH === 'true',
      node_version: process.version
    }
  });
});

app.use('/api/orders', orderRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/support', supportRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://localhost:5000/ws/tracking</code></p>');
});

// Handling 404 Route Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint resource not found.' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled express exception:', err);
  res.status(500).json({ error: 'Critical Internal Server Error.' });
});

// ============================================================================
// WEBSOCKET SERVER INIT
// ============================================================================
initWebSocketServer(server);

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 Truxify Node.js server is listening on PORT: ${PORT}`);
  console.log(`🔗 REST API Root: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket URL: ws://localhost:${PORT}/ws/tracking`);
  console.log(`================================================================`);
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received — draining connections...`);

  const forceExit = setTimeout(() => {
    console.error('[shutdown] Timeout exceeded — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExit.unref(); // Don't let this timer keep the process alive

  try {
    // 1. Stop accepting new HTTP requests; wait for in-flight ones to finish
    await new Promise((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
    console.log('[shutdown] HTTP server closed.');

    // 2. Flush buffered telemetry and close WebSocket resources
    await closeWebSocketServer();
    console.log('[shutdown] WebSocket resources closed.');

    // 3. Close database/cache connections
    await closeDbConnections();

    console.log('[shutdown] Clean exit.');
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker / Kubernetes stop
process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl+C in dev
