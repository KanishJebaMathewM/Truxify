import { describe, it, expect } from 'vitest'
import {
  validatePricePrediction,
  validatePrediction,
  convertToPaisa,
  RejectionReason,
  __testing,
} from '../../src/lib/predictionValidator.js'

describe('predictionValidator', () => {
  describe('validatePricePrediction', () => {
    it('should return NULL_RESPONSE for null or undefined input', () => {
      expect(validatePricePrediction(null)).toEqual(expect.objectContaining({ ok: false }))
      expect(validatePricePrediction(undefined)).toEqual(expect.objectContaining({ ok: false }))
      expect(validatePrediction(null)).toEqual(expect.objectContaining({ ok: false }))
      expect(validatePrediction(undefined)).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return UNEXPECTED_TYPE for non-object types', () => {
      expect(validatePricePrediction('string')).toEqual(expect.objectContaining({ ok: false }))
      expect(validatePricePrediction(123)).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return MISSING_FIELD when estimated_price is missing', () => {
      expect(validatePricePrediction({ currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return NOT_A_NUMBER when estimated_price is a string', () => {
      expect(validatePricePrediction({ estimated_price: '1000', currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return NAN when estimated_price is NaN', () => {
      expect(validatePricePrediction({ estimated_price: NaN, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INFINITY when estimated_price is Infinity', () => {
      expect(validatePricePrediction({ estimated_price: Infinity, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return ZERO when estimated_price is 0', () => {
      expect(validatePricePrediction({ estimated_price: 0, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return NEGATIVE when estimated_price is negative', () => {
      expect(validatePricePrediction({ estimated_price: -500, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return BELOW_MIN when estimated_price is below MIN_PRICE_INR (100)', () => {
      expect(validatePricePrediction({ estimated_price: 50, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return ABOVE_MAX when estimated_price exceeds MAX_PRICE_INR (500000)', () => {
      expect(validatePricePrediction({ estimated_price: 600000, currency: 'INR' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return MISSING_FIELD when currency is missing', () => {
      expect(validatePricePrediction({ estimated_price: 1000 })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INVALID_CURRENCY when currency is invalid', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'USD' })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INVALID_MIN_PRICE when min_price > estimated_price', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', min_price: 1200 })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INVALID_MAX_PRICE when max_price < estimated_price', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', max_price: 800 })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INVALID_MAX_PRICE when max_price > 3x estimated_price', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', max_price: 4000 })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return INVALID_CONFIDENCE when confidence is out of range [0, 1]', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', confidence: -0.1 })).toEqual(expect.objectContaining({ ok: false }))
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', confidence: 1.5 })).toEqual(expect.objectContaining({ ok: false }))
    })

    it('should return ok: true for a valid prediction', () => {
      const result = validatePricePrediction({ estimated_price: 5000, currency: 'INR', confidence: 0.9 })
      expect(result.ok).toBe(true)
      expect(result.validated).toBeDefined()
    })

    describe('valid predictions', () => {
      it('should accept a valid prediction with required fields', () => {
        const result = validatePricePrediction({
          estimated_price: 1000,
          currency: 'INR',
        })

        expect(result.ok).toBe(true)
        expect(result.validated.estimated_price).toBe(1000)
        expect(result.validated.currency).toBe('INR')
      })

      it('should accept a valid prediction with optional fields', () => {
        const result = validatePricePrediction({
          estimated_price: 1000,
          min_price: 850,
          max_price: 1150,
          currency: 'INR',
          confidence: 0.95,
        })

        expect(result.ok).toBe(true)
        expect(result.validated.min_price).toBe(850)
        expect(result.validated.max_price).toBe(1150)
        expect(result.validated.confidence).toBe(0.95)
      })
    })

    describe('boundary values', () => {
      it('should accept the minimum allowed price', () => {
        const result = validatePricePrediction({
          estimated_price: __testing.MIN_PRICE_INR,
          currency: 'INR',
        })

        expect(result.ok).toBe(true)
      })

      it('should accept the maximum allowed price', () => {
        const result = validatePricePrediction({
          estimated_price: __testing.MAX_PRICE_INR,
          currency: 'INR',
        })

        expect(result.ok).toBe(true)
      })

      it('should reject a price immediately below the minimum', () => {
        const result = validatePricePrediction({
          estimated_price: __testing.MIN_PRICE_INR - 1,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.BELOW_MIN)
      })

      it('should reject a price immediately above the maximum', () => {
        const result = validatePricePrediction({
          estimated_price: __testing.MAX_PRICE_INR + 1,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.ABOVE_MAX)
      })
    })

    describe('NaN and Infinity handling', () => {
      it('should reject NaN estimated_price', () => {
        const result = validatePricePrediction({
          estimated_price: NaN,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.NAN)
      })

      it('should reject positive Infinity estimated_price', () => {
        const result = validatePricePrediction({
          estimated_price: Infinity,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.INFINITY)
      })

      it('should reject negative Infinity estimated_price', () => {
        const result = validatePricePrediction({
          estimated_price: -Infinity,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.INFINITY)
      })
    })

    describe('type validation', () => {
      it('should reject a string estimated_price with NOT_A_NUMBER', () => {
        const result = validatePricePrediction({
          estimated_price: '1000',
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.NOT_A_NUMBER)
      })

      it('should reject a boolean estimated_price with NOT_A_NUMBER', () => {
        const result = validatePricePrediction({
          estimated_price: true,
          currency: 'INR',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.NOT_A_NUMBER)
      })

      it('should reject an invalid currency', () => {
        const result = validatePricePrediction({
          estimated_price: 1000,
          currency: 'USD',
        })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY)
      })
    })
  })

  describe('convertToPaisa', () => {
    it('should correctly convert valid numbers to paisa', () => {
      expect(convertToPaisa(10)).toBe(1000)
      expect(convertToPaisa(55.5)).toBe(5550)
    })

    it('should handle NaN, Infinity, and non-numbers gracefully', () => {
      expect(convertToPaisa(NaN)).toBeNull()
      expect(convertToPaisa(Infinity)).toBeNull()
      expect(convertToPaisa('invalid')).toBeNull()
      expect(convertToPaisa(null)).toBeNull()
    })
  })
})