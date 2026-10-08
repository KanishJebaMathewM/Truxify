import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import helmet from 'helmet';
import { corsMiddleware } from './middleware/cors.js';
import { compressionMiddleware } from './config/compression.js';
import hppProtection from './middleware/hppProtection.js';
import securityHeaderDuplicates from './middleware/securityHeaderDuplicates.js';
import cookieSecurityValidator from './middleware/cookieSecurityValidator.js';
import headerSizeMonitor from './middleware/headerSizeMonitor.js';

import { globalLimiter, authLimiter, healthLimiter } from './middleware/rateLimiter.js';
import { authenticate, requireRole, verifyJWT } from './middleware/auth.js';
import { requireApiKey } from './middleware/apiKey.js';
import { fraudDetectionMiddleware, networkAnalysisMiddleware } from './middleware/fraudMiddleware.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { requestIdMiddleware, requestLogger, suspiciousRequests, mongoSanitize } from './middleware/index.js';
import { tracingMiddleware } from './middleware/tracingMiddleware.js';
import { requestCacheMiddleware } from './middleware/requestCacheMiddleware.js';
import { requireJsonContent } from './middleware/contentType.js';
import { sentryRequestHandler, sentryErrorHandler } from './middleware/sentry.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getRoot, notFound } from './controllers/rootController.js';
import { supabaseAdmin } from './config/db.js';

// Route Imports
import tripRoutes from './routes/tripRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import maintenancePhotoRoutes from './routes/maintenancePhotoRoutes.js';
import iotRoutes from './routes/iotRoutes.js';
import demandRoutes from './routes/demandRoutes.js';
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
import webhookRoutes from './routes/webhookRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import droneRoutes from './routes/droneRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
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

import verificationRoutes from './routes/verificationRoutes.js';
import oracleRoutes from './routes/oracleRoutes.js';
import internalRoutes from './routes/internalRoutes.js';
import blockchainMonitoringRoutes from './routes/blockchainMonitoringRoutes.js';

import zkidRoutes from '../../zkid/routes.js';
import daoRoutes from '../../dao/routes.js';
import mevRoutes from '../../mev/routes.js';
import tokenizationRoutes from '../../tokenization/routes.js';
import atomicSwapRoutes from '../../atomic-swap/routes.js';

import trackingRoutes from './routes/trackingRoutes.js';
import publicTrackingRoutes from './routes/publicTrackingRoutes.js';
import shardRoutes from './routes/shardRoutes.js';
import shardManager from './services/sharding/ShardManager.js';

import webrtcRoutes from './routes/webrtcRoutes.js';
import ebpfRoutes from '../../../ebpf/routes.js';
import wasiRoutes from '../../../wasi/routes.js';
import wasmRoutes from '../../../wasm/routes.js';
import snykRoutes from '../../../snyk/routes.js';
import liquibaseRoutes from '../../../database/liquibase/routes.js';
import kedaRoutes from './routes/kedaRoutes.js';
import earningsRouter from './routes/earnings.js';
import fraudRoutes from './routes/fraudRoutes.js';
import zkpRoutes from './routes/zkp.routes.js';
import crossDockRoutes from './routes/crossDockRoutes.js';
import wimBypassRouter from './routes/wimBypass.js';

const app = express();

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
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
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

app.use(express.json({
  limit: jsonBodyLimit,
  strict: true,
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.use(express.urlencoded({ extended: true, limit: urlEncodedBodyLimit }));
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

// Base Root Route
app.get('/', getRoot);

// Rate-limiting & Health Routes
app.use('/api', verifyJWT);
app.use('/api/health', healthLimiter, healthRoutes);
app.use('/api/v1/health', healthLimiter, healthRoutes);
app.use('/api', globalLimiter);
app.use('/api', requestCacheMiddleware);

// Core Business & Domain Routes
app.use('/api/v1/trips', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, tripRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/orders', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, orderRoutes);
app.use('/api/cross-dock', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, crossDockRoutes);
app.use('/api/payments', authenticate, fraudDetectionMiddleware, networkAnalysisMiddleware, paymentRoutes);
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
app.use('/api/webhooks', webhookRoutes);
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
app.use('/api/toll-optimization', tollOptimizationRouter);

// Subsystem Routes
app.use('/api', zkidRoutes);
app.use('/api', daoRoutes);
app.use('/api', mevRoutes);
app.use('/api', tokenizationRoutes);
app.use('/api', atomicSwapRoutes);
app.use('/api/verify', verificationRoutes);
app.use('/api/biometric-auth', biometricAuthRoutes);
app.use('/api/oracle', oracleRoutes);
app.use('/api/carbon-credits', carbonTokenRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/tire-analytics', tireAnalyticsRoutes);
app.use('/api/ar-loading', arLoadingRoutes);

// Blockchain Monitoring Registration
const BLOCKCHAIN_MONITORING_MOUNTED = Symbol.for('truxify.api.blockchainMonitoring.mounted');
if (!blockchainMonitoringRoutes[BLOCKCHAIN_MONITORING_MOUNTED]) {
  blockchainMonitoringRoutes[BLOCKCHAIN_MONITORING_MOUNTED] = true;
  app.use('/api/blockchain', (req, _res, next) => {
    req.supabase = supabaseAdmin;
    next();
  }, blockchainMonitoringRoutes);
}

app.use('/api/internal', requireApiKey, internalRoutes);

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
  });
});

app.use('/api', shardRoutes);
app.get('/api/shard/health', async (req, res) => {
  try {
    const status = await shardManager.healthCheck();
    res.json({ status: 'healthy', shards: status, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

app.use('/api', webrtcRoutes);
app.use('/api', ebpfRoutes);
app.use('/api', wasiRoutes);
app.use('/api', wasmRoutes);
app.use('/api', snykRoutes);
app.use('/api', liquibaseRoutes);
app.use('/api/wim', wimBypassRouter);

app.get('/api/webrtc/status', (req, res) => {
  res.json({
    status: 'healthy',
    signaling: true,
    version: '1.0.0',
    websocketPath: '/webrtc',
    timestamp: new Date().toISOString()
  });
});

app.use('/api', fraudRoutes);
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

app.use('/api/zkp', zkpRoutes);
app.get
