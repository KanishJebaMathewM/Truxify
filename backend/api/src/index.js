import express from 'express'
import { corsMiddleware } from './middleware/cors.js'
import helmet from 'helmet' // 🔒 ADDED HELMET IMPORT FOR ISSUES #361 & #944
import http from 'http'
import dotenv from 'dotenv'

import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js'
import tripRoutes from './routes/tripRoutes.js'
import deviceRoutes from './routes/deviceRoutes.js'
import documentRoutes from './routes/documentRoutes.js'

import { closeDbConnections, waitForMongoDb, validateConfig } from './config/db.js'
import { orderRepository } from './core/container.js'
import { closeWebSocketServer, initWebSocketServer } from './sockets/tracker.js'
import { initLocationServer, closeLocationServer } from './sockets/locationServer.js'
import { startEscrowReleaseReconciliation, stopEscrowReleaseReconciliation } from './services/escrowReleaseReconciliation.js'
import { validateEscrowSetup } from './services/escrow.js'

// Load REST routes
import orderRoutes from './routes/orderRoutes.js'
import driverRoutes from './routes/driverRoutes.js'
import supportRoutes from './routes/supportRoutes.js'
import profileRoutes from './routes/profileRoutes.js'
import loadRoutes from './routes/loadRoutes.js'
import deadheadRoutes from './routes/deadheadRoutes.js'
import truckRoutes from './routes/truckRoutes.js'
import authRoutes from './routes/authRoutes.js'
import healthRoutes from './routes/healthRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import lookupRoutes from './routes/lookupRoutes.js'
import webhookRoutes from './routes/webhookRoutes.js'

// ============================================================================
// 🆕 MULTI-PROVIDER ORACLE & VERIFICATION ROUTES
// ============================================================================
import verificationRoutes from './routes/verificationRoutes.js'
import oracleRoutes from './routes/oracleRoutes.js'

// ============================================================================
// 🆕 GEOGRAPHIC SHARDING ROUTES
// ============================================================================
import trackingRoutes from './routes/trackingRoutes.js'
import publicTrackingRoutes from './routes/publicTrackingRoutes.js'
import shardRoutes from './routes/shardRoutes.js'
import shardManager from './services/sharding/ShardManager.js'


// ============================================================================
// 🆕 WEBRTC P2P MESH NETWORK ROUTES
// ============================================================================
import webrtcRoutes from './routes/webrtcRoutes.js'
import { initWebRTCSignaling, closeWebRTCSignaling } from './sockets/webrtc.js'

// ============================================================================
// 🆕 FRAUD DETECTION ROUTES
// ============================================================================
import fraudRoutes from './routes/fraudRoutes.js'
import { fraudDetectionMiddleware, networkAnalysisMiddleware } from './middleware/fraudMiddleware.js'
import fraudDetection from './services/fraud/FraudDetectionService.js'

// ============================================================================
// 🆕 ZK-PROOFS FOR DRIVER KYC
// ============================================================================
import zkpRoutes from './routes/zkp.routes.js'


// ============================================================================
// 🆕 MULTI-CLOUD DISASTER RECOVERY
// ============================================================================
import drRoutes from '../../dr/routes.js'
import multiCloudService from '../../dr/multi-cloud.service.js'

// ============================================================================
// 🆕 OPENTELEMETRY DISTRIBUTED TRACING
// ============================================================================
import tracing from './tracing/tracing.js'
import { tracingMiddleware } from './middleware/tracingMiddleware.js'


import logger from './middleware/logger.js'
import { setupSwagger } from './config/swagger.js'
import { correlationIdMiddleware } from './middleware/correlationId.js'
import { requestIdMiddleware, requestLogger } from './middleware/requestId.js'
import { requestCacheMiddleware } from './middleware/requestCacheMiddleware.js'
import { requireJsonContent } from './middleware/contentType.js'
import { initSentry, flushSentry, sentryErrorHandler } from './middleware/sentry.js'
import {
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation
} from './services/escrowRefundReconciliation.js'
import {
  startReputationReconciliation,
  stopReputationReconciliation,
} from './services/reputationReconciliation.js'
import {
  startDocumentExpiryWorker,
  stopDocumentExpiryWorker,
} from './services/documentExpiryService.js'
import './subscribers/reputationSubscriber.js'

// Configuration load from root folder is handled in db.js

// ============================================================================
// 🆕 INITIALIZE OPENTELEMETRY TRACING
// ============================================================================
tracing.initialize('truxify-api')

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
  logger.fatal('Escrow environment variables (POLYGON_RPC_URL, ESCROW_CONTRACT_ADDRESS, RELAYER_WALLET_PRIVATE_KEY) are not set. These are required in production for on-chain escrow protection. Set all three and restart.')
  process.exit(1)
}
if (!process.env.DRIVER_LOGIN_OTP) {
  logger.warn('DRIVER_LOGIN_OTP is not set. Driver OTP login will be disabled until it is configured in production.')
}

// ============================================================================
// 🆕 OTEL VALIDATION
// ============================================================================
if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  logger.warn('⚠️ OTEL_EXPORTER_OTLP_ENDPOINT not set. Using default: http://localhost:4317')
}

// ============================================================================
// 🆕 ORACLE VALIDATION
// ============================================================================
if (!process.env.ORACLE_CONSENSUS_THRESHOLD) {
  logger.warn('ORACLE_CONSENSUS_THRESHOLD not set, using default: 2')
}
if (!process.env.CHAINLINK_ENABLED && !process.env.BACKUP_ORACLE_ENABLED) {
  logger.warn('No oracle providers enabled. Set CHAINLINK_ENABLED=true or BACKUP_ORACLE_ENABLED=true')
}

// ============================================================================
// 🆕 SHARDING VALIDATION
// ============================================================================
if (!process.env.SHARD_NORTH_HOST || !process.env.SHARD_SOUTH_HOST || 
    !process.env.SHARD_EAST_HOST || !process.env.SHARD_WEST_HOST) {
  logger.warn('⚠️ Shard hosts not fully configured. Using localhost defaults.')
}


// ============================================================================
// 🆕 WEBRTC VALIDATION
// ============================================================================
if (!process.env.WEBRTC_ENABLED) {
  logger.info('WebRTC signaling server will start by default')
}

// ============================================================================
// 🆕 FRAUD DETECTION VALIDATION
// ============================================================================
if (!process.env.FRAUD_THRESHOLD) {
  logger.warn('FRAUD_THRESHOLD not set, using default: 0.7')
}
if (!process.env.BEHAVIORAL_ANALYTICS_ENABLED) {
  logger.info('Behavioral analytics enabled by default')
}


// ============================================================================
// 🆕 ZK-PROOFS VALIDATION
// ============================================================================
if (!process.env.KYC_VERIFIER_CONTRACT) {
  logger.warn('⚠️ KYC_VERIFIER_CONTRACT not set. ZK proof verification will not work.')
}
if (!process.env.PRIVATE_KEY) {
  logger.warn('⚠️ PRIVATE_KEY not set. Cannot sign ZK proof transactions.')
}



// ============================================================================
// 🆕 MULTI-CLOUD DR VALIDATION
// ============================================================================
if (!process.env.AWS_ACCESS_KEY || !process.env.AWS_SECRET_KEY) {
  logger.warn('⚠️ AWS credentials not set. Multi-cloud DR may not work.')
}
if (!process.env.AZURE_CONNECTION_STRING) {
  logger.warn('⚠️ Azure connection string not set. Multi-cloud DR may not work.')
}
if (!process.env.GCP_PROJECT_ID) {
  logger.warn('⚠️ GCP credentials not set. Multi-cloud DR may not work.')
}
if (!process.env.ACTIVE_CLOUD) {
  logger.warn('⚠️ ACTIVE_CLOUD not set. Using default: aws')
}


// Validate escrow contract deployment — log warning if validation fails,
// but don't crash (non-escrow functionality should still work).
validateEscrowSetup().then((valid) => {
  if (valid) {
    logger.info('✅ Escrow contract deployment validated.')
  } else {
    logger.warn(
      '⚠️  Escrow contract validation failed. Escrow operations will return ' +
      '{ txData: null } and orders will proceed without on-chain protection. ' +
      'Check ESCROW_CONTRACT_ADDRESS and the deployed contract.'
    )
  }
})

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
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      fullscreen: ['self']
    }
  },
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
// 🆕 OPENTELEMETRY TRACING MIDDLEWARE
// ============================================================================
app.use(tracingMiddleware)

// Track request start time
app.use((req, res, next) => {
  req._startTime = Date.now()
  next()
})

// ============================================================================
// CORRELATION ID + REQUEST ID + REQUEST LOGGER
// Registered before all routes and rate limiters so that every incoming
// request (including rate-limited or 404) is logged with a correlation ID.
// 1. correlationIdMiddleware — sets up AsyncLocalStorage so all downstream
//    log calls automatically include the correlationId (via logger Proxy).
// 2. requestIdMiddleware   — adds X-Request-Id header & req.requestId.
// 3. requestLogger         — logs request start / finish metadata.
// ============================================================================
app.use(correlationIdMiddleware)
app.use(requestIdMiddleware)
app.use(requestLogger)

// Enforce a known request content-type on mutating requests (POST/PUT/PATCH).
// `requireJsonContent` only rejects unrecognized media types; the three
// allowed types match the parsers registered above.
app.use(requireJsonContent)

// ============================================================================
// 🆕 FRAUD DETECTION MIDDLEWARE (Global)
// ============================================================================
app.use(fraudDetectionMiddleware)
app.use(networkAnalysisMiddleware)

// ============================================================================
// RATE LIMITING
// ============================================================================
app.use('/api/health', healthLimiter)
app.use('/api/health', healthRoutes)
app.use('/api/', globalLimiter)
app.use('/api/v1/trips', tripRoutes)

// ============================================================================
// REQUEST-SCOPED CACHE — created per-request, destroyed after response.
// Registers before all routes so every request handler benefits.
// ============================================================================
app.use('/api', requestCacheMiddleware)

// ============================================================================
// REST API ROUTING
// ============================================================================
app.use('/api/orders', orderRoutes)
app.use('/api/driver', deadheadRoutes)
app.use('/api/orders', trackingRoutes)
app.use('/api/driver', driverRoutes)
app.use('/api/loads', loadRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/driver/documents', documentRoutes)
app.use('/api/trucks', truckRoutes)
app.use('/api/v1', lookupRoutes)
app.use('/api/public', publicTrackingRoutes)
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/v1/admin', adminRoutes)

// ============================================================================
// 🆕 MULTI-PROVIDER ORACLE & VERIFICATION ROUTES
// ============================================================================
app.use('/api/verify', verificationRoutes)
app.use('/api/oracle', oracleRoutes)

// 🆕 Oracle Health Check Endpoint
app.get('/api/oracle/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    oracleEnabled: true,
    consensusThreshold: process.env.ORACLE_CONSENSUS_THRESHOLD || 2,
    providers: {
      chainlink: process.env.CHAINLINK_ENABLED === 'true',
      customVerifier: true,
      backupOracle: process.env.BACKUP_ORACLE_ENABLED === 'true'
    },
    timestamp: new Date().toISOString()
  })
})

// ============================================================================
// 🆕 GEOGRAPHIC SHARDING ROUTES
// ============================================================================
app.use('/api', shardRoutes)

// 🆕 Shard Health Check Endpoint
app.get('/api/shard/health', async (req, res) => {
  try {
    const status = await shardManager.healthCheck();
    res.json({
      status: 'healthy',
      shards: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
})


// ============================================================================
// 🆕 WEBRTC P2P MESH NETWORK ROUTES
// ============================================================================
app.use('/api', webrtcRoutes)

// 🆕 WebRTC Health Check Endpoint
app.get('/api/webrtc/status', (req, res) => {
  res.json({
    status: 'healthy',
    signaling: true,
    version: '1.0.0',
    websocketPath: '/webrtc',
    timestamp: new Date().toISOString()
  })
})

// ============================================================================
// 🆕 FRAUD DETECTION ROUTES
// ============================================================================
app.use('/api', fraudRoutes)

// 🆕 Fraud Health Check Endpoint
app.get('/api/fraud/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    threshold: process.env.FRAUD_THRESHOLD || 0.7,
    behavioralAnalytics: process.env.BEHAVIORAL_ANALYTICS_ENABLED !== 'false',
    networkAnalysis: process.env.NETWORK_ANALYSIS_ENABLED !== 'false',
    timestamp: new Date().toISOString()
  })
})


// ============================================================================
// 🆕 ZK-PROOFS FOR DRIVER KYC ROUTES
// ============================================================================
app.use('/api', zkpRoutes)

// 🆕 ZK-Proof Health Check Endpoint
app.get('/api/zkp/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    service: 'zk-snarks',
    verifierContract: process.env.KYC_VERIFIER_CONTRACT || 'not-set',
    timestamp: new Date().toISOString()
  })
})



// ============================================================================
// 🆕 MULTI-CLOUD DISASTER RECOVERY ROUTES
// ============================================================================
app.use('/api', drRoutes)

// 🆕 DR Health Check Endpoint
app.get('/api/dr/health', async (req, res) => {
  try {
    const health = await multiCloudService.checkHealth();
    res.json({
      status: 'healthy',
      data: health,
      activeCloud: multiCloudService.activeCloud,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
})

// ============================================================================
// 🆕 OPENTELEMETRY HEALTH CHECK
// ============================================================================
app.get('/api/tracing/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'opentelemetry',
    version: '1.0.0',
    isEnabled: tracing.isInitialized,
    timestamp: new Date().toISOString()
  })
})


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
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return res.status(status).json({
      error: `File upload error: ${err.message}`,
      code: err.code
    })
  }
  logger.error({ requestId: req.requestId, err }, 'Unhandled express exception')
  res.status(500).json({ error: 'Critical Internal Server Error.' })
})

// ============================================================================
// WEBSOCKET SERVER INIT (wait for MongoDB before accepting WebSocket connections)
// ============================================================================
await waitForMongoDb()
initWebSocketServer(server, orderRepository)
initLocationServer(server)

// ============================================================================
// 🆕 WEBRTC SIGNALING SERVER INIT
// ============================================================================
initWebRTCSignaling(server)
logger.info('🆕 WebRTC Signaling Server initialized at /webrtc')

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  logger.info(`Truxify API listening on port ${PORT}`)
  logger.info(`🆕 OpenTelemetry Tracing enabled (Jaeger: http://localhost:16686)`)
  logger.info(`🆕 Oracle Service enabled with threshold: ${process.env.ORACLE_CONSENSUS_THRESHOLD || 2}`)
  logger.info(`🆕 Verification endpoints available at /api/verify and /api/oracle`)
  logger.info(`🆕 Geographic Sharding enabled with 4 shards (North, South, East, West)`)

  logger.info(`🆕 WebRTC P2P Mesh Network available at ws://localhost:${PORT}/webrtc`)
  logger.info(`🆕 Fraud Detection enabled with threshold: ${process.env.FRAUD_THRESHOLD || 0.7}`)

  logger.info(`🆕 ZK-Proof KYC Verification enabled with contract: ${process.env.KYC_VERIFIER_CONTRACT || 'not-deployed'}`)

  logger.info(`☁️ Multi-Cloud Disaster Recovery enabled (Active: ${process.env.ACTIVE_CLOUD || 'aws'})`)


  logger.info(`☁️ Multi-Cloud Disaster Recovery enabled (Active: ${process.env.ACTIVE_CLOUD || 'aws'})`)

  startEscrowRefundReconciliation(orderRepository)
  startReputationReconciliation(orderRepository)
  startDlqWorker()
  startDocumentExpiryWorker()
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

  logger.info('Received shutdown signal, initiating graceful shutdown...');

  // Stop background workers
  stopEscrowReleaseReconciliation()
  stopEscrowRefundReconciliation()
  stopReputationReconciliation()
  stopDlqWorker()
  stopDocumentExpiryWorker()
  fraudDetection.destroy()

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

    // 3. Close shard connections
    await shardManager.closeAllConnections()
    logger.info('[shutdown] Shard connections closed.')

    // 4. Close database/cache connections

    // 3. Close WebRTC signaling server
    await closeWebRTCSignaling()
    logger.info('[shutdown] WebRTC signaling server closed.')

    // 4. Close shard connections
    await shardManager.closeAllConnections()
    logger.info('[shutdown] Shard connections closed.')


    // 5. Close database/cache connections


    // 5. Close OpenTelemetry tracing
    await tracing.shutdown()
    logger.info('[shutdown] OpenTelemetry tracing shut down.')

    // 6. Close database/cache connections

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