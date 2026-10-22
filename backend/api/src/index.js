import wimBypassRouter from './routes/wimBypass.js';
import iftaTaxRouter from './routes/iftaTax.js';
import express from 'express';
import { corsMiddleware } from './middleware/cors.js';
import { compressionMiddleware } from './config/compression.js';
import helmet from 'helmet';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import hppProtection from './middleware/hppProtection.js';
import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js';
import tripRoutes from './routes/tripRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import securityHeaderDuplicates from './middleware/securityHeaderDuplicates.js';
import cookieSecurityValidator from './middleware/cookieSecurityValidator.js';
import maintenancePhotoRoutes from './routes/maintenancePhotoRoutes.js';
import iotRoutes from './routes/iotRoutes.js';
import demandRoutes from './routes/demandRoutes.js';

import { closeDbConnections, waitForMongoDb, validateConfig, redisClient, supabaseAdmin } from './config/db.js';
import { getJwtSecret } from './config/jwtSecret.js';
import { startOutboxRelayWorker, stopOutboxRelayWorker } from './workers/outboxRelayWorker.js';
import { orderRepository } from './core/container.js';
import { OrderRepository } from './repositories/orderRepository.js';
import CacheManager from './cache/CacheManager.js';
import { closeWebSocketServer, initWebSocketServer, __testing as wsTesting } from './sockets/tracker.js';
import { initLocationServer, closeLocationServer } from './sockets/locationServer.js';
import { startEscrowReleaseReconciliation, stopEscrowReleaseReconciliation } from './services/escrowReleaseReconciliation.js';
import { validateEscrowSetup } from './services/escrow.js';

import {
  requestIdMiddleware,
  requestLogger,
  securityHeaders,
  suspiciousRequests,
  responseSanitizer,
  mongoSanitize,
} from './middleware/index.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import shipmentRoutes from './routes/shipmentRoutes.js';
import loadRoutes from './routes/loadRoutes.js';
import deadheadRoutes from './routes/deadheadRoutes.js';
import truckRoutes from './routes/truckRoutes.js';
import authRoutes from './routes/authRoutes.js';
import routeRoutes from './routes/routeRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import lookupRoutes from './routes/lookupRoutes.js';
import { getRoot, notFound } from './controllers/rootController.js';
import webhookRoutes from './routes/webhookRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import droneRoutes from './routes/droneRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import lumperEscrowRoutes from './routes/lumperEscrowRoutes.js';
import tollOptimizationRouter from './routes/tollOptimization.js';
import userRoutes from './routes/userRoutes.js';
import voiceRoutes from './routes/voiceRoutes.js';
import voiceAssistantRoutes from './routes/voice.routes.js';
import roadConditionRoutes from './routes/roadConditionRoutes.js';
import biometricAuthRoutes from './routes/biometricAuthRoutes.js';
import escortWalletRoutes from './routes/escortWalletRoutes.js';
import carbonTokenRoutes from './routes/carbonTokenRoutes.js';
import mlRoutes from './routes/mlRoutes.js';
import tireAnalyticsRoutes from './routes/tireAnalyticsRoutes.js';
import arLoadingRoutes from './routes/arLoadingRoutes.js';
import relayRoutes from './routes/relayRoutes.js';
import complianceRoutes from './routes/complianceRoutes.js';
import i18nRoutes from './routes/i18nRoutes.js';
import { localeMiddleware } from './lib/localeDetector.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

// Multi-provider oracle & verification routes
import verificationRoutes from './routes/verificationRoutes.js';
import oracleRoutes from './routes/oracleRoutes.js';
import internalRoutes from './routes/internalRoutes.js';
import blockchainMonitoringRoutes from './routes/blockchainMonitoringRoutes.js';

// Web3 subsystem routes
import zkidRoutes from '../../zkid/routes.js';
import daoRoutes from '../../dao/routes.js';
import mevRoutes from '../../mev/routes.js';
import tokenizationRoutes from '../../tokenization/routes.js';
import atomicSwapRoutes from '../../atomic-swap/routes.js';

// Geographic sharding routes
import trackingRoutes from './routes/trackingRoutes.js';
import publicTrackingRoutes from './routes/publicTrackingRoutes.js';
import shardRoutes from './routes/shardRoutes.js';
import shardManager from './services/sharding/ShardManager.js';

// WebRTC routes
import webrtcRoutes from './routes/webrtcRoutes.js';

// Root subsystem routes
import ebpfRoutes from '../../../ebpf/routes.js';
import wasiRoutes from '../../../wasi/routes.js';
import wasmRoutes from '../../../wasm/routes.js';
import snykRoutes from '../../../snyk/routes.js';
import liquibaseRoutes from '../../../database/liquibase/routes.js';
import kedaRoutes from './routes/kedaRoutes.js';
import earningsRouter from '../routes/earnings.js';
import { initWebRTCSignaling, closeWebRTCSignaling } from './sockets/webrtc.js';

// Fraud detection routes
import fraudRoutes from './routes/fraudRoutes.js';
import { fraudDetectionMiddleware, networkAnalysisMiddleware } from './middleware/fraudMiddleware.js';
import { authenticate, requireRole, verifyJWT } from './middleware/auth.js';
import { requireApiKey } from './middleware/apiKey.js';
import fraudDetection from './services/fraud/FraudDetectionService.js';
import headerSizeMonitor from './middleware/headerSizeMonitor.js';

// ZK-proofs
import zkpRoutes from './routes/zkp.routes.js';
import crossDockRoutes from './routes/crossDockRoutes.js';

// OpenTelemetry Distributed Tracing
import tracing from './tracing/tracing.js';
import { tracingMiddleware } from './middleware/tracingMiddleware.js';
import logger from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setupSwagger } from './config/swagger.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { requestCacheMiddleware } from './middleware/requestCacheMiddleware.js';
import { requireJsonContent } from './middleware/contentType.js';
import { initSentry, flushSentry, sentryErrorHandler, sentryRequestHandler, captureException } from './middleware/sentry.js';
import {
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation
} from './services/escrowRefundReconciliation.js';
import {
  startEscrowFundingReconciliation,
  stopEscrowFundingReconciliation
} from './services/escrowFundingReconciliation.js';
import {
  startReputationReconciliation,
  stopReputationReconciliation,
} from './services/reputationReconciliation.js';
import {
  startDocumentExpiryWorker,
  stopDocumentExpiryWorker,
} from './services/documentExpiryService.js';
import {
  startDlqWorker,
  stopDlqWorker,
} from './workers/dlqWorker.js';
import { startStaleOrderWorker, stopStaleOrderWorker } from './workers/staleOrderWorker.js';
import { startDevicePruningWorker, stopDevicePruningWorker } from './workers/devicePruningWorker.js';
import BlockchainMetrics from './services/blockchain/blockchainMetrics.js';
import EscalationHandler from './services/blockchain/escalationHandler.js';
import AlertRouter from './services/blockchain/alertRouter.js';
import BlockchainMonitor from './services/blockchain/blockchainMonitor.js';
import StateDivergenceDetector from './services/blockchain/stateDivergenceDetector.js';
import BatchCallBuilder from './services/blockchain/batchCallBuilder.js';
import {
  startWithdrawalSettlementWorker,
  stopWithdrawalSettlementWorker
} from './workers/withdrawalSettlementWorker.js';
import './subscribers/reputationSubscriber.js';

// Audit logging imports
import { auditErrors, startAuditFlushTimer } from './middleware/auditLogger.js';

tracing.initialize('truxify-api');
initSentry();

try {
  validateConfig();
} catch (err) {
  logger.fatal(err.message);
  process.exit(1);
}

CacheManager.init(redisClient);

const blockchainMetrics = new BlockchainMetrics();
const escalationHandler = new EscalationHandler({});
const alertRouter = new AlertRouter();
const blockchainMonitor = new BlockchainMonitor({
  alertRouter,
  metricsService: blockchainMetrics,
  escalationHandler,
});
const batchCallBuilder = new BatchCallBuilder({});
const stateDivergenceDetector = new StateDivergenceDetector({
  disableMonitoring: true,
  alertRouter,
  escalationHandler,
  batchCallBuilder,
});

if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'development') {
  logger.fatal('BYPASS_AUTH is enabled outside development. This is a severe security misconfiguration. Set BYPASS_AUTH=false (or unset it), and set NODE_ENV=development if you need local testing.');
  process.exit(1);
}
if (process.env.ENABLE_TEST_AUTH === 'true' && process.env.NODE_ENV !== 'test') {
  logger.fatal('ENABLE_TEST_AUTH is enabled outside a test harness. This is a severe security misconfiguration — it trusts client-supplied identity headers. Only set it in NODE_ENV=test processes.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.ML_API_KEY) {
  logger.fatal('ML_API_KEY is not set. ML engine calls will fail with 401 errors. Set ML_API_KEY and restart.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && (!process.env.POLYGON_RPC_URL || !process.env.ESCROW_CONTRACT_ADDRESS || !process.env.RELAYER_WALLET_PRIVATE_KEY)) {
  logger.fatal('Escrow environment variables (POLYGON_RPC_URL, ESCROW_CONTRACT_ADDRESS, RELAYER_WALLET_PRIVATE_KEY) are not set. These are required in production for on-chain escrow protection. Set all three and restart.');
  process.exit(1);
}
if (!process.env.DRIVER_LOGIN_OTP) {
  logger.warn('DRIVER_LOGIN_OTP is not set. Driver OTP login will be disabled until it is configured in production.');
}
if (!process.env.WEBHOOK_SECRET) {
  logger.fatal('WEBHOOK_SECRET is not set. Escrow webhook signature verification cannot run and webhook requests will be rejected. Set WEBHOOK_SECRET and restart.')
  process.exit(1)
}
// backend/api/src/index.js (Excerpt around startup checks)

// FIX: Immediately abort startup if BYPASS_AUTH is enabled in production per issue #6724
if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV === 'production') {
  console.error('FATAL: BYPASS_AUTH cannot be enabled in production. Exiting immediately.');
  process.exit(1);
}
// ============================================================================
// 🆕 WEBHOOK VALIDATION
// ============================================================================
if (!process.env.WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('WEBHOOK_SECRET is not set. POST /api/webhooks/escrow would fail closed and reject all incoming webhooks. Set WEBHOOK_SECRET and restart.');
    process.exit(1);
  } else {
    logger.warn('WARNING: WEBHOOK_SECRET is not set. Webhook requests will be rejected (fail-closed) until it is configured.');
  }
}
if (process.env.NODE_ENV === 'production') {
  try {
    getJwtSecret();
  } catch (err) {
    logger.fatal(`${err.message} Generate one with \`openssl rand -hex 48\` and restart.`);
    process.exit(1);
  }
}

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  logger.warn('WARNING: OTEL_EXPORTER_OTLP_ENDPOINT not set. Using default: http://localhost:4317');
}
if (!process.env.ORACLE_CONSENSUS_THRESHOLD) {
  logger.warn('ORACLE_CONSENSUS_THRESHOLD not set, using default: 2');
}
if (!process.env.CHAINLINK_ENABLED && !process.env.BACKUP_ORACLE_ENABLED) {
  logger.warn('No oracle providers enabled. Set CHAINLINK_ENABLED=true or BACKUP_ORACLE_ENABLED=true');
}
if (!process.env.SHARD_NORTH_HOST || !process.env.SHARD_SOUTH_HOST ||
  !process.env.SHARD_EAST_HOST || !process.env.SHARD_WEST_HOST) {
  logger.warn('WARNING: Shard hosts not fully configured. Using localhost defaults.');
}
if (!process.env.SHARD_PASSWORD && (!process.env.SHARD_PASSWORD_NORTH || !process.env.SHARD_PASSWORD_SOUTH ||
  !process.env.SHARD_PASSWORD_EAST || !process.env.SHARD_PASSWORD_WEST)) {
  logger.warn('WARNING: Shard passwords not fully configured. Ensure all SHARD_PASSWORD_* env vars are set.');
}
if (!process.env.WEBRTC_ENABLED) {
  logger.info('WebRTC signaling server will start by default');
}
if (!process.env.FRAUD_THRESHOLD) {
  logger.warn('FRAUD_THRESHOLD not set, using default: 0.7');
}
if (!process.env.BEHAVIORAL_ANALYTICS_ENABLED) {
  logger.info('Behavioral analytics enabled by default');
}
if (!process.env.KYC_VERIFIER_CONTRACT) {
  logger.warn('WARNING: KYC_VERIFIER_CONTRACT not set. ZK proof verification will not work.');
}
if (!process.env.PRIVATE_KEY) {
  logger.warn('WARNING: PRIVATE_KEY not set. Cannot sign ZK proof transactions.');
}
if (!process.env.AWS_ACCESS_KEY || !process.env.AWS_SECRET_KEY) {
  logger.warn('WARNING: AWS credentials not set. Multi-cloud DR may not work.');
}
if (!process.env.AZURE_CONNECTION_STRING) {
  logger.warn('WARNING: Azure connection string not set. Multi-cloud DR may not work.');
}
if (!process.env.GCP_PROJECT_ID) {
  logger.warn('WARNING: GCP credentials not set. Multi-cloud DR may not work.');
}
if (!process.env.ACTIVE_CLOUD) {
  logger.warn('WARNING: ACTIVE_CLOUD not set. Using default: aws');
}

validateEscrowSetup().then((valid) => {
  if (!valid) {
    logger.warn('WARNING: Escrow setup validation failed. On-chain escrow features may not work correctly.');
  }
}).catch(err => logger.error({ err }, 'Escrow setup validation failed'));

const app = express();
const server = http.createServer(app);

app.use(responseSanitizer);
app.use(sentryRequestHandler());
app.use(headerSizeMonitor);

const _parsedTrustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1;
const trustProxy = Number.isFinite(_parsedTrustProxy) ? _parsedTrustProxy : 1;
app.set('trust proxy', trustProxy);

app.use(securityHeaderDuplicates);
app.use(cookieSecurityValidator);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  hidePoweredBy: true,
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
}));

app.use(corsMiddleware);
app.use(compressionMiddleware);

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-name'];
    next();
  });
}

const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '1mb';
const urlEncodedBodyLimit = process.env.URLENCODED_BODY_LIMIT || '1mb';

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

app.use(mongoSanitize());
app.use(tracingMiddleware);

app.use((req, res, next) => {
  req._startTime = Date.now();
  next();
});

app.use(correlationIdMiddleware);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(hppProtection);
app.use(suspiciousRequests);
app.use(requireJsonContent);

app.use(localeMiddleware());

// Rate Limiting
app.use('/api', verifyJWT);
app.use('/api/health', healthLimiter);
app.use('/api/health', healthRoutes);
app.use('/api/v1/health', healthLimiter);
app.use('/api/v1/health', healthRoutes);
app.use('/api/', globalLimiter);
app.use('/api', requestCacheMiddleware);

app.use('/api/v1/trips', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, tripRoutes);
app.use('/api/trips', tripRoutes);

// REST API Routing
app.use('/api/orders', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, orderRoutes);
app.use('/api/cross-dock', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, crossDockRoutes);
app.use('/api/payments', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, paymentRoutes);
app.use('/api/lumper-escrow', lumperEscrowRoutes);
app.use('/api/driver', deadheadRoutes);
app.use('/api/orders', trackingRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/drone', droneRoutes);
app.use('/api/earnings', earningsRouter);
app.use('/api/routes', routeRoutes);
app.use('/api/v1/shipment', shipmentRoutes);
app.use('/api/loads', loadRoutes);
app.use('/api/iot', iotRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/driver/documents', documentRoutes);
app.use('/api/maintenance', maintenancePhotoRoutes);
app.use('/api/trucks', truckRoutes);
app.use('/api/v1', lookupRoutes);
app.use('/api/public', publicTrackingRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin/audit-logs', auditRoutes);
app.use('/api/v1/admin', authenticate, requireRole(['admin']), kedaRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/v1/voice', voiceAssistantRoutes);
app.use('/api/demand-heatmap', demandRoutes);
app.use('/api/road-conditions', roadConditionRoutes);
app.use('/api/escorts/wallet', escortWalletRoutes);
app.use('/api/tolls', tollOptimizationRouter);
app.use('/api/compliance', complianceRoutes);
app.use('/api/i18n', i18nRoutes);
app.use('/api/analytics', analyticsRoutes);

// Web3 Routes
app.use('/api', zkidRoutes);
app.use('/api', daoRoutes);
app.use('/api', mevRoutes);
app.use('/api', tokenizationRoutes);
app.use('/api', atomicSwapRoutes);

// Webhooks
app.use('/api/webhooks', webhookRoutes);

// Multi-provider Oracle & Verification
app.use('/api/verify', verificationRoutes);
app.use('/api/biometric-auth', biometricAuthRoutes);
app.use('/api/oracle', oracleRoutes);
app.use('/api/carbon-credits', carbonTokenRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/tire-analytics', tireAnalyticsRoutes);
app.use('/api/ar-loading', arLoadingRoutes);
app.use('/api/relay', relayRoutes);

// Sharding & Subsystem Routes
app.use('/api', shardRoutes);
app.use('/api', webrtcRoutes);
app.use('/api', ebpfRoutes);
app.use('/api', wasiRoutes);
app.use('/api', wasmRoutes);
app.use('/api', snykRoutes);
app.use('/api', liquibaseRoutes);
app.use('/api/wim', wimBypassRouter);
app.use('/api/ifta-tax', iftaTaxRouter);
app.use('/api', fraudRoutes);
app.use('/api/zkp', zkpRoutes);

// Health check endpoints
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
});

app.get('/api/webrtc/status', (req, res) => {
  res.json({
    status: 'healthy',
    signaling: true,
    version: '1.0.0',
    websocketPath: '/webrtc',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/fraud/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    threshold: process.env.FRAUD_THRESHOLD || 0.7,
    behavioralAnalytics: process.env.BEHAVIORAL_ANALYTICS_ENABLED !== 'false',
    networkAnalysis: process.env.NETWORK_ANALYSIS_ENABLED !== 'false',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/zkp/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    service: 'zk-snarks',
    verifierContract: process.env.KYC_VERIFIER_CONTRACT || 'not-set',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/tracing/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'opentelemetry',
    version: '1.0.0',
    isEnabled: tracing.isInitialized,
    timestamp: new Date().toISOString()
  });
});

const BLOCKCHAIN_MONITORING_MOUNTED = Symbol.for('truxify.api.blockchainMonitoring.mounted');
if (blockchainMonitoringRoutes[BLOCKCHAIN_MONITORING_MOUNTED]) {
  logger.fatal('[startup] /api/blockchain mounted more than once. A duplicate mount shadows the middleware that attaches req.supabase (service-role client). Remove the duplicate mount.');
  throw new Error('/api/blockchain must be mounted exactly once (#14307).');
}
blockchainMonitoringRoutes[BLOCKCHAIN_MONITORING_MOUNTED] = true;

app.use('/api/blockchain', (req, _res, next) => {
  req.blockchainMetrics = blockchainMetrics;
  req.escalationHandler = escalationHandler;
  req.blockchainMonitor = blockchainMonitor;
  req.supabase = supabaseAdmin;
  next();
}, blockchainMonitoringRoutes);

app.use('/api/internal', requireApiKey, internalRoutes);

setupSwagger(app);

app.get('/', getRoot);

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

app.use(notFound);
app.use(sentryErrorHandler());
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

await waitForMongoDb();
initWebSocketServer(server, orderRepository);
initLocationServer(server);
initWebRTCSignaling(server);
logger.info('🆕 WebRTC Signaling Server initialized at /webrtc');

if (wsTesting?.getShutdownState) {
  globalThis.__truxify_wsState = wsTesting.getShutdownState();
}

server.listen(PORT, () => {
  logger.info(`Truxify API listening on port ${PORT}`);
  logger.info(`🆕 OpenTelemetry Tracing enabled (Jaeger: http://localhost:16686)`);
  logger.info(`🆕 Oracle Service enabled with threshold: ${process.env.ORACLE_CONSENSUS_THRESHOLD || 2}`);
  logger.info(`🆕 Verification endpoints available at /api/verify and /api/oracle`);
  logger.info(`🆕 Geographic Sharding enabled with 4 shards (North, South, East, West)`);
  logger.info(`🆕 WebRTC P2P Mesh Network available at ws://localhost:${PORT}/webrtc`);
  logger.info(`🆕 Fraud Detection enabled with threshold: ${process.env.FRAUD_THRESHOLD || 0.7}`);
  logger.info(`🆕 ZK-Proof KYC Verification enabled with contract: ${process.env.KYC_VERIFIER_CONTRACT || 'not-deployed'}`);

  const escrowReconciliationOrderRepository = supabaseAdmin
    ? new OrderRepository(supabaseAdmin)
    : orderRepository;
  startEscrowRefundReconciliation(escrowReconciliationOrderRepository);
  startEscrowReleaseReconciliation(escrowReconciliationOrderRepository);
  startEscrowFundingReconciliation(escrowReconciliationOrderRepository);
  startReputationReconciliation(orderRepository);
  startDlqWorker();
  startStaleOrderWorker(escrowReconciliationOrderRepository);
  startDevicePruningWorker();
  startDocumentExpiryWorker();
  startWithdrawalSettlementWorker();
  startOutboxRelayWorker();

  let blockchainMonitorStarted = false;
  blockchainMonitor.initialize().then((initialized) => {
    if (initialized) {
      return blockchainMonitor.startListening();
    }
  }).then(() => {
    blockchainMonitorStarted = true;
    globalThis.__truxify_workers = {
      ...globalThis.__truxify_workers,
      blockchainMonitor: true,
    };
  }).catch((err) => {
    logger.error({ err }, '[BlockchainMonitor] Failed to initialize or start listening');
    globalThis.__truxify_workers = {
      ...globalThis.__truxify_workers,
      blockchainMonitor: false,
    };
  });

  stateDivergenceDetector.startMonitoring();

  globalThis.__truxify_workers = {
    escrowRefundReconciliation: true,
    escrowReleaseReconciliation: true,
    escrowFundingReconciliation: true,
    reputationReconciliation: true,
    dlqWorker: true,
    staleOrderWorker: true,
    devicePruningWorker: true,
    documentExpiryWorker: true,
    withdrawalSettlementWorker: true,
    blockchainMonitor: blockchainMonitorStarted,
  };
});

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    logger.warn(`[shutdown] ${signal} received but shutdown already in progress — forcing immediate exit.`);
    process.exit(1);
  }
  shuttingDown = true;

  logger.info('Received shutdown signal, initiating graceful shutdown...');

  stopEscrowReleaseReconciliation();
  stopEscrowRefundReconciliation();
  stopEscrowFundingReconciliation();
  stopReputationReconciliation();
  stopDlqWorker();
  stopDocumentExpiryWorker();
  stopDevicePruningWorker();
  stopWithdrawalSettlementWorker();
  stopOutboxRelayWorker();
  stopStaleOrderWorker();
  await blockchainMonitor.stopListening();
  stateDivergenceDetector.stopMonitoring();
  fraudDetection.destroy();
  CacheManager.shutdown();

  const forceExit = setTimeout(() => {
    logger.error('[shutdown] Timeout exceeded — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  let exitCode = 0;

  try {
    await new Promise((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
    logger.info('[shutdown] HTTP server closed.');

    await closeWebSocketServer();
    await closeLocationServer();
    logger.info('[shutdown] WebSocket resources closed.');

    await shardManager.closeAllConnections();
    logger.info('[shutdown] Shard connections closed.');

    await closeWebRTCSignaling();
    logger.info('[shutdown] WebRTC signaling server closed.');

    await tracing.shutdown();
    logger.info('[shutdown] OpenTelemetry tracing shut down.');

    await closeDbConnections();
    logger.info('[shutdown] Clean exit.');
  } catch (err) {
    logger.error({ err }, '[shutdown] Error during shutdown');
    exitCode = 1;
  } finally {
    clearTimeout(forceExit);
    process.exit(exitCode);
  }
}

process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  await flushSentry(2000);
  await shutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  captureException(reason);
  await flushSentry(2000);
  await shutdown('unhandledRejection');
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
