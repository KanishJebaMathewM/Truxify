import { describe, it, expect } from 'vitest'
import { sanitizeUploadFilename, checkContentLength } from '../../src/lib/uploadFilename.js'
describe('uploadFilename utilities', () => {
  describe('sanitizeUploadFilename', () => {
    it('should return fallback for null, undefined, or empty input', () => {
      expect(sanitizeUploadFilename(null)).toBe('upload')
      expect(sanitizeUploadFilename(undefined)).toBe('upload')
      expect(sanitizeUploadFilename('')).toBe('upload')
    })

    it('should strip path traversal sequences to filename only', () => {
      const result = sanitizeUploadFilename('../../etc/passwd')
      expect(result).not.toContain('..')
      expect(result).not.toContain('/')
    })

    it('should remove control characters', () => {
      const result = sanitizeUploadFilename('file\u0000name\u001F.txt')
      expect(result).not.toContain('\u0000')
      expect(result).not.toContain('\u001F')
    })

    it('should convert non-alphanumeric characters to underscores', () => {
      const result = sanitizeUploadFilename('my file@name!.txt')
      expect(result).toContain('_')
    })

    it('should strip leading dots to prevent hidden files', () => {
      const result = sanitizeUploadFilename('.hiddenfile.txt')
      expect(result.startsWith('.')).toBe(false)
    })

    it('should collapse repeated dots', () => {
      const result = sanitizeUploadFilename('file...name.txt')
      expect(result).not.toContain('...')
    })

    it('should return fallback for Windows reserved names', () => {
      const reserved = ['con.txt', 'prn', 'nul.png', 'com1']
      reserved.forEach(name => {
        const sanitized = sanitizeUploadFilename(name)
        expect(sanitized).toBe('upload')
      })
    })

    it('should enforce max length of 120 chars while preserving extension', () => {
      const longName = 'a'.repeat(150) + '.txt'
      const result = sanitizeUploadFilename(longName)
      expect(result.length).toBeLessThanOrEqual(120)
      expect(result.endsWith('.txt')).toBe(true)
    })
  })

  describe('checkContentLength', () => {
    it('should return status 411 when Content-Length is missing', () => {
      const req = { headers: {} }
      const result = checkContentLength(req, 1000)
      
      expect(result.ok).toBe(false)
      expect(result.error.status).toBe(411)
    })

    it('should return status 400 when Content-Length is non-numeric', () => {
      const req = { headers: { 'content-length': 'invalid' } }
      const result = checkContentLength(req, 1000)

      expect(result.ok).toBe(false)
      expect(result.error.status).toBe(400)
    })

    it('should return status 413 when Content-Length exceeds maxBytes', () => {
      const req = { headers: { 'content-length': '5000' } }
      const result = checkContentLength(req, 1000)

      expect(result.ok).toBe(false)
      expect(result.error.status).toBe(413)
    })

    it('should return ok: true and length when Content-Length is valid', () => {
      const req = { headers: { 'content-length': '500' } }
      const result = checkContentLength(req, 1000)

      expect(result.ok).toBe(true)
      expect(result.length).toBe(500)
    })
  })
})
