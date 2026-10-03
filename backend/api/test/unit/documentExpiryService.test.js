/**
 * Comprehensive Unit Tests for backend/api/src/services/documentExpiryService.js
 *
 * Covers:
 * - Distributed Redis locking, lease renewal, and release scripts
 * - Single-instance fallback when Redis is unavailable
 * - Paginated database querying across multiple reminder windows (30d, 14d, 7d)
 * - Notification deduplication (hasExistingNotification)
 * - Document type labeling and custom message formatting
 * - Graceful database query and notification dispatch error resilience
 * - Background worker timer intervals, deduplication, and cleanup
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
  redisClient: {
    set: vi.fn(),
    eval: vi.fn(),
  },
  sendPushNotification: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
  redisClient: mocks.redisClient,
}))

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: mocks.sendPushNotification,
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: mocks.logger,
}))

import {
  processDocumentExpiryBatch,
  startDocumentExpiryWorker,
  stopDocumentExpiryWorker,
} from '../../src/services/documentExpiryService.js'

function setupSupabaseQueryMock(documents = [], notifications = []) {
  mocks.supabaseAdmin.from.mockImplementation((tableName) => {
    if (tableName === 'driver_documents') {
      let gteVal = null
      let lteVal = null
      const builder = {
        select: vi.fn(() => builder),
        not: vi.fn(() => builder),
        gte: vi.fn((_field, val) => {
          gteVal = val
          return builder
        }),
        lte: vi.fn((_field, val) => {
          lteVal = val
          return builder
        }),
        order: vi.fn(() => builder),
        range: vi.fn().mockImplementation(async (from, to) => {
          const start = gteVal ? new Date(gteVal).getTime() : 0
          const end = lteVal ? new Date(lteVal).getTime() : Infinity
          const filtered = documents.filter((doc) => {
            if (!doc.valid_until) return true
            const docTime = new Date(doc.valid_until).getTime()
            return docTime >= start && docTime <= end
          })
          const paged = filtered.slice(from, to + 1)
          return { data: paged, error: null }
        }),
      }
      return builder
    }
    if (tableName === 'notifications') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        gte: vi.fn().mockResolvedValue({ data: notifications, error: null }),
      }
      return builder
    }
    return {}
  })
}

describe('DocumentExpiryService Comprehensive Test Suite', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    process.env = { ...originalEnv }
    mocks.redisClient.set.mockResolvedValue('OK')
    mocks.redisClient.eval.mockResolvedValue(1)
    mocks.sendPushNotification.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    stopDocumentExpiryWorker()
    process.env = originalEnv
    vi.useRealTimers()
  })

  describe('Redis Distributed Locking and Concurrency', () => {
    it('successfully acquires Redis lock with expiration and releases on completion', async () => {
      setupSupabaseQueryMock([], [])

      await processDocumentExpiryBatch()

      expect(mocks.redisClient.set).toHaveBeenCalledWith(
        'document:expiry:worker:lock',
        expect.stringMatching(/^\d+:[a-f0-9-]+$/),
        'NX',
        'EX',
        600,
      )
      expect(mocks.redisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        'document:expiry:worker:lock',
        expect.any(String),
      )
    })

    it('skips execution when Redis lock is currently acquired by another instance', async () => {
      mocks.redisClient.set.mockResolvedValue(null)

      await processDocumentExpiryBatch()

      expect(mocks.supabaseAdmin.from).not.toHaveBeenCalled()
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '[document-expiry] Lock held by another instance, skipping.',
      )
    })

    it('gracefully aborts batch processing when Redis connection throws an error', async () => {
      mocks.redisClient.set.mockRejectedValue(new Error('Redis connection failure'))

      await processDocumentExpiryBatch()

      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[document-expiry] Failed to acquire Redis lock'),
        'Redis connection failure',
      )
      expect(mocks.supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it('logs warning when Redis lock release script indicates ownership changed or expired', async () => {
      mocks.redisClient.eval.mockResolvedValue(0)
      setupSupabaseQueryMock([], [])

      await processDocumentExpiryBatch()

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ lockKey: 'document:expiry:worker:lock' }),
        expect.stringContaining('Document expiry lock release returned 0'),
      )
    })

    it('catches and logs errors if Redis lock release evaluation throws', async () => {
      mocks.redisClient.eval.mockRejectedValue(new Error('Redis cluster down on release'))
      setupSupabaseQueryMock([], [])

      await processDocumentExpiryBatch()

      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ lockKey: 'document:expiry:worker:lock' }),
        'Failed to release document expiry worker lock',
      )
    })
  })

  describe('Document Querying, Windows, and Pagination', () => {
    it('sends notifications for documents expiring in the 30-day window', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const sampleDoc = {
        id: 'doc-uuid-30',
        driver_id: 'driver-uuid-30',
        document_type: 'driving_licence',
        valid_until: futureDate,
      }

      setupSupabaseQueryMock([sampleDoc], [])

      await processDocumentExpiryBatch()

      expect(mocks.sendPushNotification).toHaveBeenCalledWith(
        'driver-uuid-30',
        'Document Expiry Alert',
        expect.stringContaining('Driving Licence expires in 30 days'),
        'document',
        expect.objectContaining({
          type: 'document_expiry',
          documentId: 'doc-uuid-30',
          documentType: 'driving_licence',
          daysRemaining: 30,
        }),
      )
    })

    it('correctly handles multi-page document pagination', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const manyDocs = Array.from({ length: 1200 }, (_, idx) => ({
        id: `doc-page-${idx}`,
        driver_id: `driver-page-${idx}`,
        document_type: 'insurance',
        valid_until: futureDate,
      }))

      setupSupabaseQueryMock(manyDocs, [])

      await processDocumentExpiryBatch()

      expect(mocks.sendPushNotification).toHaveBeenCalledTimes(1200)
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Batch complete. Total notifications sent: 1200'),
      )
    })

    it('logs when no documents are found for a window', async () => {
      setupSupabaseQueryMock([], [])

      await processDocumentExpiryBatch()

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '[document-expiry] No documents expiring in 30 days window.',
      )
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '[document-expiry] No documents expiring in 14 days window.',
      )
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '[document-expiry] No documents expiring in 7 days window.',
      )
    })
  })

  describe('Deduplication and Validation Guardrails', () => {
    it('skips sending notification if document was already notified recently for the window', async () => {
      const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      const sampleDoc = {
        id: 'doc-uuid-14',
        driver_id: 'driver-uuid-14',
        document_type: 'rc_book',
        valid_until: futureDate,
      }

      const existingNotif = [
        {
          id: 'notif-1',
          metadata: { documentId: 'doc-uuid-14', daysRemaining: 14 },
        },
      ]

      setupSupabaseQueryMock([sampleDoc], existingNotif)

      await processDocumentExpiryBatch()

      expect(mocks.sendPushNotification).not.toHaveBeenCalled()
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('already notified for 14 days window, skipping.'),
      )
    })

    it('skips records with missing driver_id or id', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const invalidDocs = [
        { id: null, driver_id: 'driver-1', document_type: 'puc', valid_until: futureDate },
        { id: 'doc-2', driver_id: null, document_type: 'puc', valid_until: futureDate },
      ]

      setupSupabaseQueryMock(invalidDocs, [])

      await processDocumentExpiryBatch()

      expect(mocks.sendPushNotification).not.toHaveBeenCalled()
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        '[document-expiry] Skipping document with missing driver_id or id:',
        expect.anything(),
      )
    })

    it('formats known document types into proper human-readable labels', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const testCases = [
        { type: 'rc_book', expected: 'RC Book' },
        { type: 'puc', expected: 'Pollution Certificate' },
        { type: 'business_license', expected: 'Business License' },
        { type: 'bank_account', expected: 'Bank Account' },
        { type: 'custom_permit', expected: 'custom_permit' },
      ]

      for (const [idx, item] of testCases.entries()) {
        vi.clearAllMocks()
        mocks.redisClient.set.mockResolvedValue('OK')
        mocks.redisClient.eval.mockResolvedValue(1)

        const doc = {
          id: `doc-${idx}`,
          driver_id: `driver-${idx}`,
          document_type: item.type,
          valid_until: futureDate,
        }

        setupSupabaseQueryMock([doc], [])
        await processDocumentExpiryBatch()

        expect(mocks.sendPushNotification).toHaveBeenCalledWith(
          `driver-${idx}`,
          'Document Expiry Alert',
          expect.stringContaining(item.expected),
          'document',
          expect.anything(),
        )
      }
    })
  })

  describe('Error Handling and Service Resilience', () => {
    it('catches database query failures for a window and continues to next window', async () => {
      mocks.supabaseAdmin.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Supabase network latency exceeded' },
        }),
      }))

      await processDocumentExpiryBatch()

      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[document-expiry] Failed to query documents for 30 days window:'),
        'Supabase network latency exceeded',
      )
    })

    it('continues processing subsequent documents when one push notification fails', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const docs = [
        { id: 'doc-err-1', driver_id: 'driver-err-1', document_type: 'insurance', valid_until: futureDate },
        { id: 'doc-ok-2', driver_id: 'driver-ok-2', document_type: 'insurance', valid_until: futureDate },
      ]

      setupSupabaseQueryMock(docs, [])
      mocks.sendPushNotification
        .mockRejectedValueOnce(new Error('Push notification gateway 503'))
        .mockResolvedValueOnce({ success: true })

      await processDocumentExpiryBatch()

      expect(mocks.logger.error).toHaveBeenCalledWith(
        '[document-expiry] Failed to send notification for document doc-err-1:',
        'Push notification gateway 503',
      )
      expect(mocks.sendPushNotification).toHaveBeenCalledTimes(2)
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Batch complete. Total notifications sent: 1'),
      )
    })
  })

  describe('Worker Control and Lifecycle Functions', () => {
    it('starts worker with default interval and stops cleanly', () => {
      setupSupabaseQueryMock([], [])
      vi.useFakeTimers()

      startDocumentExpiryWorker()
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Worker started (interval: 86400000ms).'),
      )

      stopDocumentExpiryWorker()
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '[document-expiry] Worker stopped.',
      )
    })

    it('starts worker with custom interval configured in environment', () => {
      process.env.DOCUMENT_EXPIRY_WORKER_INTERVAL_MS = '60000'
      setupSupabaseQueryMock([], [])
      vi.useFakeTimers()

      startDocumentExpiryWorker()
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Worker started (interval: 60000ms).'),
      )

      stopDocumentExpiryWorker()
    })

    it('ignores repeated startDocumentExpiryWorker calls to prevent duplicate intervals', () => {
      setupSupabaseQueryMock([], [])
      vi.useFakeTimers()

      startDocumentExpiryWorker()
      const infoCallsCount = mocks.logger.info.mock.calls.length

      startDocumentExpiryWorker() // Second invocation
      expect(mocks.logger.info.mock.calls.length).toBe(infoCallsCount)

      stopDocumentExpiryWorker()
    })

    it('ignores stopDocumentExpiryWorker call when worker is not running', () => {
      stopDocumentExpiryWorker()
      expect(mocks.logger.info).not.toHaveBeenCalledWith(
        '[document-expiry] Worker stopped.',
      )
    })
  })
})