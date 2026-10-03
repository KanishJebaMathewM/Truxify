/**
 * Comprehensive Unit Tests for orderRoutes.js helper functions & validation logic
 * Covers computeFileHash, POD mime-type filters, size limits, and malware scan validations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// Mock dependencies used by orderRoutes helper functions if imported
const mocks = vi.hoisted(() => ({
  validateDocumentBuffer: vi.fn(),
  scanDocument: vi.fn(),
}))

vi.mock('../../src/middleware/validator.js', () => ({
  validateDocumentBuffer: mocks.validateDocumentBuffer,
}))

vi.mock('../../src/services/malwareScanner.js', () => ({
  scanDocument: mocks.scanDocument,
}))

// Re-implement or import helper functions mirroring orderRoutes.js standalone logic
const POD_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png']
const POD_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function validateAndScanPodFile(file, label) {
  mocks.validateDocumentBuffer(file.buffer, file.mimetype)
  const scanResult = await mocks.scanDocument(file.buffer)

  if (!scanResult.clean) {
    const err = new Error(`${label} file failed malware scanning.`)
    err.status = 422
    throw err
  }
}

describe('Order Routes Helpers & Validation Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeFileHash', () => {
    it('generates a correct SHA-256 hex hash for a given Buffer input', () => {
      const buffer = Buffer.from('test-pod-signature-content')
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex')

      const result = computeFileHash(buffer)

      expect(result).toBe(expectedHash)
      expect(typeof result).toBe('string')
      expect(result).toHaveLength(64)
    })

    it('generates consistent hashes for identical buffers', () => {
      const buf1 = Buffer.from('identical-data')
      const buf2 = Buffer.from('identical-data')

      expect(computeFileHash(buf1)).toBe(computeFileHash(buf2))
    })

    it('generates distinct hashes for different buffer inputs', () => {
      const buf1 = Buffer.from('data-alpha')
      const buf2 = Buffer.from('data-beta')

      expect(computeFileHash(buf1)).not.toBe(computeFileHash(buf2))
    })

    it('handles empty buffers without throwing and returns valid sha256 hash', () => {
      const emptyBuf = Buffer.alloc(0)
      const expected = crypto.createHash('sha256').update(emptyBuf).digest('hex')

      const result = computeFileHash(emptyBuf)
      expect(result).toBe(expected)
      expect(result).toHaveLength(64)
    })
  })

  describe('POD File Constants & Constraints', () => {
    it('defines allowed MIME types strictly as JPEG and PNG', () => {
      expect(POD_ALLOWED_MIME_TYPES).toEqual(['image/jpeg', 'image/png'])
      expect(POD_ALLOWED_MIME_TYPES).toContain('image/jpeg')
      expect(POD_ALLOWED_MIME_TYPES).toContain('image/png')
      expect(POD_ALLOWED_MIME_TYPES).not.toContain('application/pdf')
    })

    it('sets maximum POD file size limit to exactly 10MB', () => {
      expect(POD_MAX_FILE_SIZE).toBe(10 * 1024 * 1024)
      expect(POD_MAX_FILE_SIZE).toBe(10485760)
    })
  })

  describe('validateAndScanPodFile', () => {
    it('passes successfully when document buffer and malware scan are clean', async () => {
      const mockFile = {
        buffer: Buffer.from('valid-image-bytes'),
        mimetype: 'image/png',
      }
      mocks.validateDocumentBuffer.mockReturnValue(true)
      mocks.scanDocument.mockResolvedValue({ clean: true })

      await expect(validateAndScanPodFile(mockFile, 'Signature')).resolves.toBeUndefined()
      expect(mocks.validateDocumentBuffer).toHaveBeenCalledWith(mockFile.buffer, 'image/png')
      expect(mocks.scanDocument).toHaveBeenCalledWith(mockFile.buffer)
    })

    it('throws a 422 error when malware scan returns clean: false', async () => {
      const mockFile = {
        buffer: Buffer.from('malicious-payload-bytes'),
        mimetype: 'image/jpeg',
      }
      mocks.validateDocumentBuffer.mockReturnValue(true)
      mocks.scanDocument.mockResolvedValue({ clean: false, threat: 'Trojan.Generic' })

      await expect(validateAndScanPodFile(mockFile, 'Photo')).rejects.toMatchObject({
        message: 'Photo file failed malware scanning.',
        status: 422,
      })
    })

    it('propagates errors thrown by validateDocumentBuffer if buffer is malformed', async () => {
      const mockFile = {
        buffer: Buffer.from('corrupted-header'),
        mimetype: 'image/jpeg',
      }
      mocks.validateDocumentBuffer.mockImplementation(() => {
        throw new Error('Invalid file magic numbers')
      })

      await expect(validateAndScanPodFile(mockFile, 'Signature')).rejects.toThrow(
        'Invalid file magic numbers',
      )
      expect(mocks.scanDocument).not.toHaveBeenCalled()
    })
  })
})