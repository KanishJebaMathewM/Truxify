import wimBypassRouter from './routes/wimBypass.js';
import express from 'express'
import { corsMiddleware } from './middleware/cors.js'
import { compressionMiddleware } from './config/compression.js'
import helmet from 'helmet' // 🔒 ADDED HELMET IMPORT FOR ISSUES #361 & #944
import http from 'http'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
import hppProtection from './middleware/hppProtection.js';

import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js'
import tripRoutes from './routes/tripRoutes.js'
import deviceRoutes from './routes/deviceRoutes.js'
import documentRoutes from './routes/documentRoutes.js'
import securityHeaderDuplicates from './middleware/securityHeaderDuplicates.js';
import cookieSecurityValidator from './middleware/cookieSecurityValidator.js';
import maintenancePhotoRoutes from './routes/maintenancePhotoRoutes.js'

import { closeDbConnections, waitForMongoDb, validateConfig, redisClient, supabaseAdmin } from './config/db.js'
import { orderRepository } from './core/container.js'
import { OrderRepository } from './repositories/orderRepository.js'
import CacheManager from './cache/CacheManager.js'
import { closeWebSocketServer, initWebSocketServer, __testing as wsTesting } from './sockets/tracker.js'
import { initLocationServer, closeLocationServer } from './sockets/locationServer.js'
import { startEscrowReleaseReconciliation, stopEscrowReleaseReconciliation } from './services/escrowReleaseReconciliation.js'
import { validateEscrowSetup } from './services/escrow.js'


import {
  requestIdMiddleware,
  requestLogger,
  securityHeaders,
  suspiciousRequests,
  responseSanitizer,
} from "./middleware/index.js";
// Load REST routes
import orderRoutes from './routes/orderRoutes.js'
import driverRoutes from './routes/driverRoutes.js'
import supportRoutes from './routes/supportRoutes.js'
import profileRoutes from './routes/profileRoutes.js'
import shipmentRoutes from './routes/shipmentRoutes.js'
import loadRoutes from './routes/loadRoutes.js'
import iotRoutes from './routes/iotRoutes.js'
import deadheadRoutes from './routes/deadheadRoutes.js'
import truckRoutes from './routes/truckRoutes.js'
import authRoutes from './routes/authRoutes.js'
import routeRoutes from './routes/routeRoutes.js'
import healthRoutes from './routes/healthRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import lookupRoutes from './routes/lookupRoutes.js'
import { getRoot, notFound } from './controllers/rootController.js'
import webhookRoutes from './routes/webhookRoutes.js'
import auditRoutes from './routes/auditRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import userRoutes from './routes/userRoutes.js'
import voiceRoutes from './routes/voiceRoutes.js'
import voiceAssistantRoutes from './routes/voice.routes.js'
import demandRoutes from './routes/demandRoutes.js'
import roadConditionRoutes from './routes/roadConditionRoutes.js'
import escortWalletRoutes from './routes/escortWalletRoutes.js'
import mlRoutes from './routes/mlRoutes.js'

// ============================================================================
// 🆕 MULTI-PROVIDER ORACLE & VERIFICATION ROUTES
// ============================================================================
import verificationRoutes from './routes/verificationRoutes.js'
import oracleRoutes from './routes/oracleRoutes.js'
import blockchainMonitoringRoutes from './routes/blockchainMonitoringRoutes.js'

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

// ============================================================================
// 🆕 ROOT SUBSYSTEM ROUTES (eBPF, WASI, WASM, Snyk, Liquibase)
// ============================================================================
import ebpfRoutes from '../../../ebpf/routes.js'
import wasiRoutes from '../../../wasi/routes.js'
import wasmRoutes from '../../../wasm/routes.js'
import snykRoutes from '../../../snyk/routes.js'
import liquibaseRoutes from '../../../database/liquibase/routes.js'
import kedaRoutes from './routes/kedaRoutes.js'
import earningsRouter from '../routes/earnings.js'
import { initWebRTCSignaling, closeWebRTCSignaling } from './sockets/webrtc.js'

// ============================================================================
// 🆕 FRAUD DETECTION ROUTES
// ============================================================================
import fraudRoutes from './routes/fraudRoutes.js'
import { fraudDetectionMiddleware, networkAnalysisMiddleware } from './middleware/fraudMiddleware.js'
import { authenticate, requireRole } from './middleware/auth.js'
import fraudDetection from './services/fraud/FraudDetectionService.js'
import headerSizeMonitor from './middleware/headerSizeMonitor.js';

// ============================================================================
// 🆕 ZK-PROOFS FOR DRIVER KYC
// ============================================================================
import zkpRoutes from './routes/zkp.routes.js'


// ============================================================================
// 🆕 OPENTELEMETRY DISTRIBUTED TRACING
// ============================================================================
import tracing from './tracing/tracing.js'
import { tracingMiddleware } from './middleware/tracingMiddleware.js'
import logger from './middleware/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { setupSwagger } from './config/swagger.js'
import { correlationIdMiddleware } from './middleware/correlationId.js'
import { requestCacheMiddleware } from './middleware/requestCacheMiddleware.js'
import { requireJsonContent } from './middleware/contentType.js'
import { initSentry, flushSentry, sentryRequestHandler, captureException, sentryErrorHandler } from './middleware/sentry.js'
import {
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation
} from './services/escrowRefundReconciliation.js'
import {
  startEscrowFundingReconciliation,
  stopEscrowFundingReconciliation
} from './services/escrowFundingReconciliation.js'
import {
  startReputationReconciliation,
  stopReputationReconciliation,
} from './services/reputationReconciliation.js'
import {
  startDocumentExpiryWorker,
  stopDocumentExpiryWorker,
} from './services/documentExpiryService.js'
import {
  startDlqWorker,
  stopDlqWorker,
} from './workers/dlqWorker.js'
import { startStaleOrderWorker } from './workers/staleOrderWorker.js'
import BlockchainMetrics from './services/blockchain/blockchainMetrics.js'
import EscalationHandler from './services/blockchain/escalationHandler.js'
import {
  startWithdrawalSettlementWorker,
  stopWithdrawalSettlementWorker
} from './workers/withdrawalSettlementWorker.js'
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
// INITIALIZE DISTRIBUTED CACHE MANAGER
// ============================================================================
CacheManager.init(redisClient)

// ============================================================================
// BLOCKCHAIN MONITORING — singletons shared with blockchainMonitoringRoutes
// ============================================================================
const blockchainMetrics = new BlockchainMetrics()
const escalationHandler = new EscalationHandler({})

// ============================================================================
// STARTUP VALIDATION — crash fast, not at request time
// ============================================================================
if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'development') {
  logger.fatal('BYPASS_AUTH is enabled outside development. This is a severe security misconfiguration. Set BYPASS_AUTH=false (or unset it), and set NODE_ENV=development if you need local testing.')
  process.exit(1)
}
// ENABLE_TEST_AUTH allows plaintext x-user-id/x-user-role header impersonation
// and must never be active outside a dedicated test harness (NODE_ENV=test).
if (process.env.ENABLE_TEST_AUTH === 'true' && process.env.NODE_ENV !== 'test') {
  logger.fatal('ENABLE_TEST_AUTH is enabled outside a test harness. This is a severe security misconfiguration — it trusts client-supplied identity headers. Only set it in NODE_ENV=test processes.')
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
if (!process.env.WEBHOOK_SECRET) {
  logger.fatal('WEBHOOK_SECRET is not set. Escrow webhook signature verification cannot run and webhook requests will be rejected. Set WEBHOOK_SECRET and restart.')
  process.exit(1)
}

// ============================================================================
// 🆕 WEBHOOK VALIDATION
// ============================================================================
if (!process.env.WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('WEBHOOK_SECRET is not set. POST /api/webhooks/escrow would fail closed and reject all incoming webhooks. Set WEBHOOK_SECRET and restart.')
    process.exit(1)
  } else {
    logger.warn('⚠️ WEBHOOK_SECRET is not set. Webhook requests will be rejected (fail-closed) until it is configured.')
  }
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

if (!process.env.SHARD_PASSWORD_NORTH || !process.env.SHARD_PASSWORD_SOUTH || 
    !process.env.SHARD_PASSWORD_EAST || !process.env.SHARD_PASSWORD_WEST) {
  logger.warn('⚠️ Shard passwords not fully configured. Ensure all SHARD_PASSWORD_* env vars are set.')
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
  if (!valid) {
    logger.warn('⚠️ Escrow setup validation failed. On-chain escrow features may not work correctly.')
  }
}).catch(err => logger.error({ err }, 'Escrow setup validation failed'))

const app = express()
const server = http.createServer(app)
app.use(sentryRequestHandler());
app.use(headerSizeMonitor);
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
app.use(securityHeaderDuplicates);
app.use(cookieSecurityValidator);
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

// ============================================================================
// RESPONSE COMPRESSION
// Registered after the security headers and before the routes that generate
// large bodies. Clients that do not advertise Accept-Encoding: gzip continue
// to receive identical uncompressed responses.
// ============================================================================
app.use(compressionMiddleware)

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
const jsonBodyLimit =
  process.env.JSON_BODY_LIMIT || '1mb';
const urlEncodedBodyLimit =
  process.env.URLENCODED_BODY_LIMIT || '1mb';

app.use(
  express.json({
    limit: jsonBodyLimit,
    strict: true,
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: urlEncodedBodyLimit,
  })
);

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

app.use(hppProtection)
app.use(suspiciousRequests)

// Enforce a known request content-type on mutating requests (POST/PUT/PATCH).
// `requireJsonContent` only rejects unrecognized media types; the three
// allowed types match the parsers registered above.
app.use(requireJsonContent)

/// Fraud middleware is NOT registered globally here.
// It is applied per-route after authenticate() so req.user is always set.
// See individual route mounts below.

// ============================================================================
// RATE LIMITING
// ============================================================================
app.use('/api/health', healthLimiter)
app.use('/api/health', healthRoutes)
app.use('/api/v1/health', healthLimiter)
app.use('/api/v1/health', healthRoutes)
app.use('/api/', globalLimiter)
app.use('/api/v1/trips', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, tripRoutes)
app.use('/api/trips', tripRoutes)
// ============================================================================
// REQUEST-SCOPED CACHE — created per-request, destroyed after response.
// Registers before all routes so every request handler benefits.
// ============================================================================
app.use('/api', requestCacheMiddleware)

// ============================================================================
// REST API ROUTING
// ============================================================================
app.use('/api/orders', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, orderRoutes)
app.use('/api/payments', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, paymentRoutes)
app.use('/api/driver', deadheadRoutes)
app.use('/api/orders', trackingRoutes)
app.use('/api/driver', driverRoutes)
// Mounted here, with the other REST routes, so it sits behind the full
// middleware chain — body parsers, correlation/request IDs, HPP protection,
// content-type enforcement, fraud detection and the /api rate limiter.
// Registering it earlier silently bypasses every one of them.
app.use('/api/earnings', earningsRouter)
app.use('/api/routes', routeRoutes)
app.use('/api/v1/shipment', shipmentRoutes)
app.use('/api/loads', loadRoutes)
app.use('/api/iot', iotRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/users', userRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/driver/documents', documentRoutes)
app.use('/api/maintenance', maintenancePhotoRoutes)
app.use('/api/trucks', truckRoutes)
app.use('/api/v1', lookupRoutes)
app.use('/api/public', publicTrackingRoutes)
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/admin/audit-logs', auditRoutes)
app.use('/api/v1/admin', authenticate, requireRole(['admin']), kedaRoutes)
app.use('/api/voice', voiceRoutes)
app.use('/api/v1/voice', voiceAssistantRoutes)
app.use('/api/demand-heatmap', demandRoutes)
app.use('/api/road-conditions', roadConditionRoutes)
app.use('/api/escorts/wallet', escortWalletRoutes)

// ============================================================================
// WEBHOOK ROUTES
// ============================================================================
app.use('/api/webhooks', webhookRoutes)

// ============================================================================
// 🆕 MULTI-PROVIDER ORACLE & VERIFICATION ROUTES
// ============================================================================
app.use('/api/verify', verificationRoutes)
app.use('/api/oracle', oracleRoutes)
app.use('/api/ml', mlRoutes)

// ============================================================================
// 🆕 BLOCKCHAIN MONITORING ROUTES
// Attach the monitoring services and service-role client per request so the
// handlers never fall back to the anon-key client (RLS would hide all rows).
// NOTE: /api/blockchain must be mounted exactly once — a duplicate mount
// registered earlier shadows this one and leaves req.supabase undefined.
// ============================================================================
app.use('/api/blockchain', (req, _res, next) => {
  req.blockchainMetrics = blockchainMetrics
  req.escalationHandler = escalationHandler
  req.supabase = supabaseAdmin
  next()
}, blockchainMonitoringRoutes)

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

// ============================================================================
// 🆕 ROOT SUBSYSTEM ROUTES (eBPF, WASI, WASM, Snyk, Liquibase)
// ============================================================================
app.use('/api', ebpfRoutes)
app.use('/api', wasiRoutes)
app.use('/api', wasmRoutes)
app.use('/api', snykRoutes)
app.use('/api', liquibaseRoutes)
app.use('/api/wim', wimBypassRouter)

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
app.use('/api/zkp', zkpRoutes)

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
app.get('/', getRoot)

app.use(responseSanitizer)

// Handling 404 Route Not Found
app.use(notFound)
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

// Expose WebSocket state for health aggregation
globalThis.__truxify_wsState = wsTesting.getShutdownState()

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


  // Reconciliation workers sweep `orders` for stuck funding/refund states.
  // They must run with the service-role client: the anon client has no RLS
  // read access to `orders`, so an anon-backed repository would silently no-op.
  const escrowReconciliationOrderRepository = supabaseAdmin
    ? new OrderRepository(supabaseAdmin)
    : orderRepository;
  startEscrowRefundReconciliation(escrowReconciliationOrderRepository)
  startEscrowReleaseReconciliation(escrowReconciliationOrderRepository)
  startEscrowFundingReconciliation(escrowReconciliationOrderRepository)
  startReputationReconciliation(orderRepository)
  startDlqWorker()
  startStaleOrderWorker(escrowReconciliationOrderRepository)
  startDocumentExpiryWorker()
  startWithdrawalSettlementWorker()

  // Register worker states for health aggregation
  globalThis.__truxify_workers = {
    escrowRefundReconciliation: true,
    escrowReleaseReconciliation: true,
    escrowFundingReconciliation: true,
    reputationReconciliation: true,
    dlqWorker: true,
    staleOrderWorker: true,
    documentExpiryWorker: true,
    withdrawalSettlementWorker: true,
  }
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
  stopEscrowFundingReconciliation()
  stopReputationReconciliation()
  stopDlqWorker()
  stopDocumentExpiryWorker()
  stopWithdrawalSettlementWorker()
  fraudDetection.destroy()
  CacheManager.shutdown()

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

    // 4. Close WebRTC signaling server
    await closeWebRTCSignaling()
    logger.info('[shutdown] WebRTC signaling server closed.')

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
  captureException(reason)
  await flushSentry(2000)
  await shutdown('unhandledRejection')
})

process.on('SIGTERM', () => shutdown('SIGTERM')) // Docker / Kubernetes stop
process.on('SIGINT', () => shutdown('SIGINT')) // Ctrl+C in dev

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    logger.warn(
      {
        requestId: req.requestId,
        ip: req.ip,
        method: req.method,
        path: req.originalUrl,
      },
      'Request payload exceeded configured limit'
    );

    return res.status(413).json({
      error: 'Payload too large',
    });
  }

  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    'body' in err
  ) {
    logger.warn(
      {
        requestId: req.requestId,
        ip: req.ip,
        method: req.method,
        path: req.originalUrl,
      },
      'Malformed JSON payload received'
    );

    return res.status(400).json({
      error: 'Malformed JSON payload',
    });
  }

  next(err);
});
