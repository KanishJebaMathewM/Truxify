import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAppendFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('fs/promises', () => ({
  appendFile: mockAppendFile,
}))

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}))

const { mockDbState } = vi.hoisted(() => {
  const admin = {
    from: vi.fn(),
  }
  return {
    mockDbState: {
      supabaseAdmin: admin,
    },
  }
})

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() {
    return mockDbState.supabaseAdmin
  },
}))

import { auditLogService } from '../../src/services/auditLogService.js'

function makeInsertChain(mockData, mockError) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockData, error: mockError }),
  }
  chain.insert = vi.fn().mockReturnValue(chain)
  return chain
}

function makeSelectChain(mockData, mockError, mockCount) {
  const q = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: mockData, error: mockError, count: mockCount }),
  }
  q.select = vi.fn().mockReturnValue(q)
  return q
}

describe('AuditLogService', () => {
  const validEntry = {
    actorId: 'actor-123',
    actorRole: 'admin',
    actorName: 'Admin Operator',
    action: 'admin:view-dashboard',
    resourceType: 'order',
    resourceId: 'order-999',
    method: 'GET',
    path: '/api/admin/orders/999',
    ipAddress: '127.0.0.1',
    userAgent: 'VitestTestAgent/1.0',
    correlationId: 'corr-xyz',
    requestId: 'req-abc',
    statusCode: 200,
    beforeState: { status: 'pending' },
    afterState: { status: 'confirmed' },
    metadata: { reason: 'manual review' },
  }

  let defaultAdmin

  beforeEach(() => {
    vi.clearAllMocks()
    defaultAdmin = {
      from: vi.fn(),
    }
    mockDbState.supabaseAdmin = defaultAdmin
  })

  describe('log()', () => {
    it('returns null and throws no error when supabaseAdmin is null', async () => {
      mockDbState.supabaseAdmin = null

      const result = await auditLogService.log(validEntry)

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Supabase admin client not available')
      )
      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('returns null and logs warning when actorId is missing', async () => {
      const entryWithoutActor = { ...validEntry }
      delete entryWithoutActor.actorId

      const result = await auditLogService.log(entryWithoutActor)

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('actorId is required')
      )
      expect(defaultAdmin.from).not.toHaveBeenCalled()
      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('returns inserted data on valid entry and successful DB insert', async () => {
      const insertedRecord = { id: 'audit-log-1', ...validEntry, created_at: '2026-09-14T00:00:00Z' }
      const insertChain = makeInsertChain(insertedRecord, null)
      defaultAdmin.from.mockReturnValue(insertChain)

      const result = await auditLogService.log(validEntry)

      expect(result).toEqual(insertedRecord)
      expect(defaultAdmin.from).toHaveBeenCalledWith('application_audit_logs')
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-123',
          actor_role: 'admin',
          action: 'admin:view-dashboard',
          resource_type: 'order',
          resource_id: 'order-999',
        })
      )
      expect(mockAppendFile).not.toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('returns null and writes dead-letter entry on DB insert error', async () => {
      const insertChain = makeInsertChain(null, { message: 'Database connection failed' })
      defaultAdmin.from.mockReturnValue(insertChain)

      const result = await auditLogService.log(validEntry)

      expect(result).toBeNull()
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: { message: 'Database connection failed' } },
        '[AuditLog] Failed to insert audit entry'
      )
      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const [filePath, fileContent] = mockAppendFile.mock.calls[0]
      expect(filePath).toContain('audit-dead-letter.log')
      const parsedContent = JSON.parse(fileContent.trim())
      expect(parsedContent.actor_id).toBe('actor-123')
      expect(parsedContent._deadLetterReason).toBe('Database connection failed')
      expect(parsedContent._deadLetteredAt).toBeDefined()
    })

    it('returns null and writes dead-letter entry when DB insert throws exception', async () => {
      const insertChain = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockRejectedValue(new Error('Network socket hang up')),
      }
      insertChain.insert = vi.fn().mockReturnValue(insertChain)
      defaultAdmin.from.mockReturnValue(insertChain)

      const result = await auditLogService.log(validEntry)

      expect(result).toBeNull()
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        '[AuditLog] Exception inserting audit entry'
      )
      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const [filePath, fileContent] = mockAppendFile.mock.calls[0]
      expect(filePath).toContain('audit-dead-letter.log')
      const parsedContent = JSON.parse(fileContent.trim())
      expect(parsedContent.actor_id).toBe('actor-123')
      expect(parsedContent._deadLetterReason).toBe('Network socket hang up')
    })
  })

  describe('query()', () => {
    it('returns empty data with default pagination when supabaseAdmin is null', async () => {
      mockDbState.supabaseAdmin = null

      const result = await auditLogService.query({ actorId: 'actor-123' })

      expect(result).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      })
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Supabase admin client not available')
      )
    })

    it('clamps pagination page and limit bounds correctly (safePage, safeLimit 1-100)', async () => {
      const selectChain = makeSelectChain([], null, 0)
      defaultAdmin.from.mockReturnValue(selectChain)

      // Test page < 1 and limit > 100
      await auditLogService.query({ page: -5, limit: 500 })

      expect(selectChain.range).toHaveBeenCalledWith(0, 99)

      // Test invalid page/limit fallback
      await auditLogService.query({ page: 'invalid', limit: 'invalid' })

      expect(selectChain.range).toHaveBeenCalledWith(0, 19)

      // Test page 3, limit 15
      await auditLogService.query({ page: 3, limit: 15 })

      expect(selectChain.range).toHaveBeenCalledWith(30, 44)
    })

    it('falls back to created_at when invalid sortBy column is provided', async () => {
      const selectChain = makeSelectChain([], null, 0)
      defaultAdmin.from.mockReturnValue(selectChain)

      await auditLogService.query({ sortBy: 'unsupported_column', sortOrder: 'asc' })

      expect(selectChain.order).toHaveBeenCalledWith('created_at', { ascending: true })
    })

    it('applies filters for actorId, action, resourceType, resourceId, startDate, and endDate', async () => {
      const mockRecords = [
        { id: 'log-1', action: 'admin:update-settings' },
        { id: 'log-2', action: 'admin:update-settings' },
      ]
      const selectChain = makeSelectChain(mockRecords, null, 2)
      defaultAdmin.from.mockReturnValue(selectChain)

      const result = await auditLogService.query({
        actorId: 'actor-99',
        action: 'admin:update-settings',
        resourceType: 'system_config',
        resourceId: 'cfg-1',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.999Z',
        page: 1,
        limit: 10,
        sortBy: 'action',
        sortOrder: 'desc',
      })

      expect(defaultAdmin.from).toHaveBeenCalledWith('application_audit_logs')
      expect(selectChain.select).toHaveBeenCalledWith('*', { count: 'exact' })
      expect(selectChain.eq).toHaveBeenCalledWith('actor_id', 'actor-99')
      expect(selectChain.eq).toHaveBeenCalledWith('action', 'admin:update-settings')
      expect(selectChain.eq).toHaveBeenCalledWith('resource_type', 'system_config')
      expect(selectChain.eq).toHaveBeenCalledWith('resource_id', 'cfg-1')
      expect(selectChain.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00.000Z')
      expect(selectChain.lte).toHaveBeenCalledWith('created_at', '2026-01-31T23:59:59.999Z')
      expect(selectChain.order).toHaveBeenCalledWith('action', { ascending: false })
      expect(selectChain.range).toHaveBeenCalledWith(0, 9)

      expect(result).toEqual({
        data: mockRecords,
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        },
      })
    })

    it('returns empty data and logs error on DB query error', async () => {
      const selectChain = makeSelectChain(null, { message: 'Query execution error' }, null)
      defaultAdmin.from.mockReturnValue(selectChain)

      const result = await auditLogService.query({ page: 2, limit: 10 })

      expect(result).toEqual({
        data: [],
        pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
      })
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: { message: 'Query execution error' } },
        '[AuditLog] Failed to query audit logs'
      )
    })
  })
})
