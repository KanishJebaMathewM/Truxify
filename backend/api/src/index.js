import http from 'http'
import { closeDbConnections, waitForMongoDb, validateConfig, redisClient, supabaseAdmin } from './config/db.js'
import { startOutboxRelayWorker, stopOutboxRelayWorker } from './workers/outboxRelayWorker.js'
import { orderRepository } from './core/container.js'
import { OrderRepository } from './repositories/orderRepository.js'
import { closeWebSocketServer, initWebSocketServer, __testing as wsTesting } from './sockets/tracker.js'
import { initLocationServer, closeLocationServer } from './sockets/locationServer.js'
import { startEscrowReleaseReconciliation, stopEscrowReleaseReconciliation } from './services/escrowReleaseReconciliation.js'
import blockchainMonitoringRoutes from './routes/blockchainMonitoringRoutes.js'
import { initWebRTCSignaling, closeWebRTCSignaling } from './sockets/webrtc.js'
import logger from './middleware/logger.js'
import { startStaleOrderWorker, stopStaleOrderWorker } from './workers/staleOrderWorker.js'
import { startDevicePruningWorker, stopDevicePruningWorker } from './workers/devicePruningWorker.js'
import BlockchainMonitor from './services/blockchain/blockchainMonitor.js'
import StateDivergenceDetector from './services/blockchain/stateDivergenceDetector.js'
import app from './app.js'

const server = http.createServer(app)


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
  startDevicePruningWorker()
  startDocumentExpiryWorker()
  startWithdrawalSettlementWorker()
  startOutboxRelayWorker()

  // Start BlockchainMonitor during API startup.
  // Worker health flag is set only after successful initialization.
  let blockchainMonitorStarted = false
  blockchainMonitor.initialize().then((initialized) => {
    if (initialized) {
      return blockchainMonitor.startListening()
    }
  }).then(() => {
    blockchainMonitorStarted = true
    globalThis.__truxify_workers = {
      ...globalThis.__truxify_workers,
      blockchainMonitor: true,
    }
  }).catch((err) => {
    logger.error({ err }, '[BlockchainMonitor] Failed to initialize or start listening')
    globalThis.__truxify_workers = {
      ...globalThis.__truxify_workers,
      blockchainMonitor: false,
    }
  })

  // Start StateDivergenceDetector after blockchain monitor warms up.
  stateDivergenceDetector.startMonitoring()

  // Register worker states for health aggregation
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
    // blockchainMonitor flag is set async above after successful startup
    blockchainMonitor: blockchainMonitorStarted,
  }
})

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
const SHUTDOWN_TIMEOUT_MS = 10_000

/** @type {boolean} */
let shuttingDown = false

async function shutdown(signal) {
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
  stopDevicePruningWorker()
  stopWithdrawalSettlementWorker()
  stopOutboxRelayWorker()
  stopStaleOrderWorker()
  await blockchainMonitor.stopListening()
  stateDivergenceDetector.stopMonitoring()
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

// --- COMPLIANCE IMPORTS ---
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
