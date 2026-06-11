import express from 'express';
import cors from 'cors';
import helmet from 'helmet'; // 🔒 ADDED HELMET IMPORT FOR ISSUE #361
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';
import tripRoutes from './routes/tripRoutes.js';

import { closeDbConnections } from './config/db.js';
import { closeWebSocketServer, initWebSocketServer } from './sockets/tracker.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import profileRoutes from './routes/profileRoutes.js';

// Configuration load from root folder is handled in db.js

// ============================================================================
// STARTUP VALIDATION — crash fast, not at request time
// ============================================================================
if (process.env.NODE_ENV === 'production' && process.env.BYPASS_AUTH === 'true') {
  console.error('FATAL: BYPASS_AUTH is enabled in production. This is a severe security misconfiguration.');
  console.error('Set BYPASS_AUTH=false (or unset it) and restart the server.');
  process.exit(1);
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
app.use('/api/v1/trips', tripRoutes);

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
app.use('/api/profile', profileRoutes);
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
  console.log(`🔒 Security Headers: Enabled via Helmet`);
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