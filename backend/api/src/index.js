import express from 'express'
import { corsMiddleware } from './middleware/cors.js'
import helmet from 'helmet' // 🔒 ADDED HELMET IMPORT FOR ISSUES #361 & #944
import http from 'http'
import dotenv from 'dotenv'
import path from 'path'
import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js'
import tripRoutes from './routes/tripRoutes.js'
import deviceRoutes from './routes/deviceRoutes.js'
import documentRoutes from './routes/documentRoutes.js'

import { closeDbConnections, waitForMongoDb, validateConfig, supabase } from './config/db.js'
import { OrderRepository } from './repositories/orderRepository.js'

const orderRepository = new OrderRepository(supabase)
import { closeWebSocketServer, initWebSocketServer } from './sockets/tracker.js'
import { initLocationServer, closeLocationServer } from './sockets/locationServer.js'
import { startEscrowReleaseReconciliation, stopEscrowReleaseReconciliation } from './services/escrowReleaseReconciliation.js'

// Load REST routes
import orderRoutes from './routes/orderRoutes.js'
import driverRoutes from './routes/driverRoutes.js'
import supportRoutes from './routes/supportRoutes.js'
import profileRoutes from './routes/profileRoutes.js'
import loadRoutes from './routes/loadRoutes.js'
import truckRoutes from './routes/truckRoutes.js'
import authRoutes from './routes/authRoutes.js'
import healthRoutes from './routes/healthRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import lookupRoutes from './routes/lookupRoutes.js'

import logger from './middleware/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { setupSwagger } from './config/swagger.js'
import { requestIdMiddleware, requestLogger } from './middleware/requestId.js'
import { initSentry, flushSentry, sentryErrorHandler } from './middleware/sentry.js'
import {
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation
} from './services/escrowRefundReconciliation.js'
import {
  startReputationReconciliation,
  stopReputationReconciliation,
} from './services/reputationReconciliation.js'

// Configuration load from root folder is handled in db.js

initSentry()

// Validate required env vars at startup
try {
  validateConfig()
} catch (err) {
  logger.fatal(err.message)
  process.exit(1)
}

// ============================================================================
// STARTUP VALIDATION — crash fast, not at request time
// ============================================================================
if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'development') {
  logger.fatal('BYPASS_AUTH is enabled outside development. This is a severe security misconfiguration. Set BYPASS_AUTH=false (or unset it), and set NODE_ENV=development if you need local testing.')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && !process.env.ML_API_KEY) {
  logger.fatal('ML_API_KEY is not set. ML engine calls will fail with 401 errors. Set ML_API_KEY and restart.')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && (!process.env.POLYGON_RPC_URL || !process.env.ESCROW_CONTRACT_ADDRESS || !process.env.RELAYER_WALLET_PRIVATE_KEY)) {
  logger.fatal('Escrow environment variables (POLYGON_RPC_URL, ESCROW_CONTRACT_ADDRESS, RELAYER_WALLET_PRIVATE_KEY) are not set. These are required in production for on-chain escrow protection. Set all three and restart.');
  process.exit(1);
}
if (!process.env.DRIVER_LOGIN_OTP) {
  logger.warn('DRIVER_LOGIN_OTP is not set. Driver OTP login will be disabled until it is configured in production.')
}
const app = express()
const server = http.createServer(app)

// Trust proxy required for rate-limiting behind load balancers/Docker.
// TRUST_PROXY env var allows each deployment to set the correct proxy count:
//   - Production (behind Nginx/ALB/Cloudflare) → 1 (default)
//   - Docker Compose (no proxy)                 → 0
//   - Multiple proxy hops (e.g. Cloudflare→Nginx) → 2
const trustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1
app.set('trust proxy', trustProxy)

// ============================================================================
// 🔒 ADVANCED SECURITY HEADERS (HELMET CONFIGURATION)
// Resolves missing security headers from Issues #361 and #944
// ============================================================================
app.use(helmet({
  // Content Security Policy (CSP) - Prevents XSS and data injection
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // Strict CSP enforced
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  // HTTP Strict Transport Security (HSTS) - Enforces HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // X-Frame-Options - Prevents clickjacking by disabling iframes
  frameguard: {
    action: 'deny'
  },
  // X-Content-Type-Options - Prevents MIME-sniffing
  noSniff: true,
  // Additional modern security headers
  crossOriginEmbedderPolicy: false, // Set false if breaking third-party images/maps
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows Flutter app to fetch resources
  dnsPrefetchControl: { allow: false },
  hidePoweredBy: true, // Removes X-Powered-By: Express
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}))

app.use(corsMiddleware)

// ── Production header sanitization (defense in depth) ────────────────
// Even if a proxy or misconfiguration lets dev auth headers through,
// strip them before they reach any route handler in production.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    delete req.headers['x-user-id']
    delete req.headers['x-user-role']
    delete req.headers['x-user-name']
    next()
  })
}

// Payload parsers
app.use(express.json({ limit: '1mb' })) // Added payload limit for security
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// ============================================================================
// REQUEST ID + REQUEST LOGGER — registered before all routes and rate limiters
// so that every incoming request (including rate-limited or 404) is logged.
// ============================================================================
app.use(requestIdMiddleware)
app.use(requestLogger)

// ============================================================================
// RATE LIMITING
// ============================================================================
app.use('/api/health', healthLimiter)
app.use('/api/health', healthRoutes)
app.use('/api/', globalLimiter)
app.use('/api/v1/trips', tripRoutes)

// ============================================================================
// REST API ROUTING
// ============================================================================

  app.use('/api/orders', orderRoutes)
  app.use('/api/driver', driverRoutes)
  app.use('/api/loads', loadRoutes)
  app.use('/api/support', supportRoutes)
  app.use('/api/profile', profileRoutes)
  app.use('/api/devices', deviceRoutes)
  app.use('/api/driver/documents', documentRoutes)
  app.use('/api/trucks', truckRoutes)
  app.use('/api/v1', lookupRoutes)
  app.use('/api/auth', authLimiter, authRoutes)
  app.use('/api/v1/admin', adminRoutes)

// Setup Swagger Documentation
setupSwagger(app)

// Root route
app.get('/', (req, res) => {
  const wsHost = req.hostname || 'localhost'
  const wsPort = process.env.PORT || 5000
  res.send(`<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://${wsHost}:${wsPort}/ws/tracking</code></p>`)
})

// Handling 404 Route Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint resource not found.' })
})

// Sentry error handler must come before the generic error handler;
// it captures the exception automatically so we don't call captureException here.
app.use(sentryErrorHandler())

// Error handling middleware
app.use(errorHandler)

// ============================================================================
// WEBSOCKET SERVER INIT (wait for MongoDB before accepting WebSocket connections)
// ============================================================================
await waitForMongoDb()
initWebSocketServer(server, orderRepository)
initLocationServer(server)

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  logger.info(`Truxify API listening on port ${PORT}`)
  startEscrowRefundReconciliation(orderRepository)
  startEscrowReleaseReconciliation()
  startReputationReconciliation()
})

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
const SHUTDOWN_TIMEOUT_MS = 10_000

/** @type {boolean} */
let shuttingDown = false

async function shutdown (signal) {
  // Guard against recursive shutdown calls (e.g. an error inside shutdown
  // triggering uncaughtException while we're already shutting down).
  if (shuttingDown) {
    logger.warn(`[shutdown] ${signal} received but shutdown already in progress — forcing immediate exit.`)
    process.exit(1)
  }
  shuttingDown = true

  logger.info(`${signal} received — draining connections...`)

  // Stop reconciliation timers so no new work starts during the drain.
  stopEscrowRefundReconciliation()
  stopEscrowReleaseReconciliation()
  stopReputationReconciliation()

  const forceExit = setTimeout(() => {
    logger.error('[shutdown] Timeout exceeded — forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref() // Don't let this timer keep the process alive

  let exitCode = 0

  try {
    // 1. Stop accepting new HTTP requests; wait for in-flight ones to finish
    await new Promise((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    )
    logger.info('[shutdown] HTTP server closed.')

    // 2. Flush buffered telemetry and close WebSocket resources
    await closeWebSocketServer()
    await closeLocationServer()
    logger.info('[shutdown] WebSocket resources closed.')

    // 3. Close database/cache connections
    await closeDbConnections()

    logger.info('[shutdown] Clean exit.')
  } catch (err) {
    logger.error({ err }, '[shutdown] Error during shutdown')
    exitCode = 1
  } finally {
    clearTimeout(forceExit)
    process.exit(exitCode)
  }
}

// Handle uncaught exceptions and unhandled rejections.
// Both handlers route through shutdown() so that connections are drained
// before exit. The forceExit timer inside shutdown() catches hangs.
process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting')
  await flushSentry(2000)
  await shutdown('uncaughtException')
})

process.on('unhandledRejection', async (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection')
  await shutdown('unhandledRejection')
})

process.on('SIGTERM', () => shutdown('SIGTERM')) // Docker / Kubernetes stop
process.on('SIGINT', () => shutdown('SIGINT')) // Ctrl+C in dev
