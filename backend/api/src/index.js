import express from 'express';
import cors from 'cors';
import helmet from 'helmet'; // 🔒 ADDED HELMET IMPORT FOR ISSUE #361
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js';
import tripRoutes from './routes/tripRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';

import { closeDbConnections, waitForMongoDb, validateConfig } from './config/db.js';
import { closeWebSocketServer, initWebSocketServer } from './sockets/tracker.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import loadRoutes from './routes/loadRoutes.js';
import truckRoutes from './routes/truckRoutes.js';
import authRoutes from './routes/authRoutes.js';
import healthRoutes from './routes/healthRoutes.js';

import logger from './middleware/logger.js';
import { requestIdMiddleware, requestLogger } from './middleware/requestId.js';
import { initSentry, flushSentry, sentryErrorHandler } from './middleware/sentry.js';
import {
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation,
} from './services/escrowRefundReconciliation.js';

// Configuration load from root folder is handled in db.js

initSentry();

// Validate required env vars at startup
try {
  validateConfig();
} catch (err) {
  logger.fatal(err.message);
  process.exit(1);
}

// ============================================================================
// STARTUP VALIDATION — crash fast, not at request time
// ============================================================================
if (process.env.NODE_ENV === 'production' && process.env.BYPASS_AUTH === 'true') {
  logger.fatal('BYPASS_AUTH is enabled in production. This is a severe security misconfiguration. Set BYPASS_AUTH=false (or unset it) and restart the server.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.ML_API_KEY) {
  logger.fatal('ML_API_KEY is not set. ML engine calls will fail with 401 errors. Set ML_API_KEY and restart.');
  process.exit(1);
}
if (!process.env.DRIVER_LOGIN_OTP) {
  logger.warn('DRIVER_LOGIN_OTP is not set. Driver OTP login will be disabled until it is configured in production.');
}
const app = express();
const server = http.createServer(app);

// Trust proxy required for rate-limiting behind load balancers/Docker
app.set('trust proxy', 1);

// ============================================================================
// 🔒 ADVANCED SECURITY HEADERS (HELMET CONFIGURATION)
// Resolves missing security headers from Issue #361
// ============================================================================
app.use(helmet({
  // Content Security Policy (CSP) - Prevents XSS and data injection
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Adjust if strict CSP is needed for frontend
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  // HTTP Strict Transport Security (HSTS) - Enforces HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // X-Frame-Options - Prevents clickjacking by disabling iframes
  frameguard: {
    action: "deny"
  },
  // X-Content-Type-Options - Prevents MIME-sniffing
  noSniff: true,
  // Additional modern security headers
  crossOriginEmbedderPolicy: false, // Set false if breaking third-party images/maps
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allows Flutter app to fetch resources
  dnsPrefetchControl: { allow: false },
  hidePoweredBy: true, // Removes X-Powered-By: Express
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true
}));

// ============================================================================
// CORS CONFIGURATION
// ============================================================================
// Enable CORS for frontend clients (Flutter Web, mobile, etc.)
const corsOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
  : '*';
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

// In production, x-user-id / x-user-role / x-user-name must NOT be accepted
// as authentication headers — only expose them in non-production.
const corsAllowedHeaders = process.env.NODE_ENV === 'production'
  ? ['Content-Type', 'Authorization']
  : ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-user-name'];

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
  allowedHeaders: corsAllowedHeaders,
}));

// ── Production header sanitization (defense in depth) ────────────────
// Even if a proxy or misconfiguration lets dev auth headers through,
// strip them before they reach any route handler in production.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-name'];
    next();
  });
}

// Payload parsers
app.use(express.json({ limit: '1mb' })); // Added payload limit for security
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ============================================================================
// REQUEST ID + REQUEST LOGGER — registered before all routes and rate limiters
// so that every incoming request (including rate-limited or 404) is logged.
// ============================================================================
app.use(requestIdMiddleware);
app.use(requestLogger);

// ============================================================================
// RATE LIMITING
// ============================================================================
app.use('/api/', globalLimiter);
app.use('/api/health', healthLimiter);
app.use('/api/v1/trips', tripRoutes);

// ============================================================================
// REST API ROUTING
// ============================================================================
app.use('/api/health', healthRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/loads', loadRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/trucks', truckRoutes);
app.use('/api/auth', authLimiter, authRoutes);
// Root route
app.get('/', (req, res) => {
  res.send('<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://localhost:5000/ws/tracking</code></p>');
});

// Handling 404 Route Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint resource not found.' });
});

// Sentry error handler must come before the generic error handler;
// it captures the exception automatically so we don't call captureException here.
app.use(sentryErrorHandler());

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({ requestId: req.requestId, err }, 'Unhandled express exception');
  res.status(500).json({ error: 'Critical Internal Server Error.' });
});

// ============================================================================
// WEBSOCKET SERVER INIT (wait for MongoDB before accepting WebSocket connections)
// ============================================================================
await waitForMongoDb();
initWebSocketServer(server);

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  logger.info(`Truxify API listening on port ${PORT}`);
  startEscrowRefundReconciliation();
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal) {
  logger.info(`${signal} received — draining connections...`);
  stopEscrowRefundReconciliation();

  const forceExit = setTimeout(() => {
    logger.error('[shutdown] Timeout exceeded — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExit.unref(); // Don't let this timer keep the process alive

  try {
    // 1. Stop accepting new HTTP requests; wait for in-flight ones to finish
    await new Promise((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
    logger.info('[shutdown] HTTP server closed.');

    // 2. Flush buffered telemetry and close WebSocket resources
    await closeWebSocketServer();
    logger.info('[shutdown] WebSocket resources closed.');

    // 3. Close database/cache connections
    await closeDbConnections();

    logger.info('[shutdown] Clean exit.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '[shutdown] Error during shutdown');
    process.exit(1);
  }
}

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  await flushSentry(2000);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  await flushSentry(2000);
});

process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker / Kubernetes stop
process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl+C in dev
