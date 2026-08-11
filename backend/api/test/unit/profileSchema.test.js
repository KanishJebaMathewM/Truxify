import { describe, it, expect } from 'vitest'
import { updateProfileSchema, profileQuerySchema, VALID_LANGUAGES } from '../../src/schemas/profile.js'

describe('profile schemas', () => {
  describe('VALID_LANGUAGES', () => {
    it('contains supported language codes', () => {
      expect(VALID_LANGUAGES).toContain('en')
      expect(VALID_LANGUAGES).toContain('hi')
    })
  })

  describe('updateProfileSchema', () => {
    it('accepts a valid partial profile update', () => {
      const result = updateProfileSchema.safeParse({ full_name: 'Anand', dark_mode: true })
      expect(result.success).toBe(true)
    })

    it('rejects a blank name', () => {
      const result = updateProfileSchema.safeParse({ full_name: '   ' })
      expect(result.success).toBe(false)
    })

    it('rejects an invalid email', () => {
      const result = updateProfileSchema.safeParse({ email: 'not-an-email' })
      expect(result.success).toBe(false)
    })

    it('rejects unknown fields due to strict mode', () => {
      const result = updateProfileSchema.safeParse({ admin: true })
      expect(result.success).toBe(false)
    })
  })

  describe('profileQuerySchema', () => {
    it('coerces is_active from a string to a boolean', () => {
      const result = profileQuerySchema.safeParse({ is_active: 'true' })
      expect(result.success).toBe(true)
      expect(result.data.is_active).toBe(true)
    })

    it('rejects an invalid role', () => {
      const result = profileQuerySchema.safeParse({ role: 'superadmin' })
      expect(result.success).toBe(false)
    })
  })
})
