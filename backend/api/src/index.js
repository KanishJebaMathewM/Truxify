import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';

// Pre-load DB config to execute client setups
import './config/db.js';
import { initWebSocketServer } from './sockets/tracker.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';

// Configuration load from root folder is handled in db.js


const app = express();
const server = http.createServer(app);

// Enable CORS for frontend clients (Flutter Web, mobile, etc.)
app.use(cors({
  origin: '*', // Allow all origins for development; tighten in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-user-name']
}));

app.use(express.json());

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

    // 2. Your WebSocket server likely exposes a .close() — call it here
    // await closeWebSocketServer();

    // 3. Close DB connections, flush queues, etc.
    // await db.end();

    console.log('[shutdown] Clean exit.');
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker / Kubernetes stop
process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl+C in dev
