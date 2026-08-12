import { describe, it, expect, beforeEach } from 'vitest';
import { demandConfig } from '../../../src/config/demand.js';

describe('demandConfig', () => {
  describe('baseEarningRate', () => {
    it('defaults to 18.50 when env not set', () => {
      expect(demandConfig.baseEarningRate).toBe(18.50);
    });

    it('parses a valid number from env', () => {
      const original = process.env.DEMAND_BASE_EARNING_RATE;
      process.env.DEMAND_BASE_EARNING_RATE = '20.00';
      // Module is already loaded; test the current value
      expect(demandConfig.baseEarningRate).toBe(20.00);
      if (original !== undefined) {
        process.env.DEMAND_BASE_EARNING_RATE = original;
      } else {
        delete process.env.DEMAND_BASE_EARNING_RATE;
      }
    });

    it('falls back to default for invalid env value', () => {
      const original = process.env.DEMAND_BASE_EARNING_RATE;
      process.env.DEMAND_BASE_EARNING_RATE = 'not-a-number';
      expect(demandConfig.baseEarningRate).toBe(18.50);
      if (original !== undefined) {
        process.env.DEMAND_BASE_EARNING_RATE = original;
      } else {
        delete process.env.DEMAND_BASE_EARNING_RATE;
      }
    });

    it('falls back to default for empty string', () => {
      const original = process.env.DEMAND_BASE_EARNING_RATE;
      process.env.DEMAND_BASE_EARNING_RATE = '';
      expect(demandConfig.baseEarningRate).toBe(18.50);
      if (original !== undefined) {
        process.env.DEMAND_BASE_EARNING_RATE = original;
      } else {
        delete process.env.DEMAND_BASE_EARNING_RATE;
      }
    });
  });

  describe('routeMultiplierBase', () => {
    it('defaults to 1.2 when env not set', () => {
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
    });

    it('falls back to default for NaN', () => {
      const original = process.env.DEMAND_ROUTE_MULTIPLIER_BASE;
      process.env.DEMAND_ROUTE_MULTIPLIER_BASE = 'abc';
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
      if (original !== undefined) {
        process.env.DEMAND_ROUTE_MULTIPLIER_BASE = original;
      } else {
        delete process.env.DEMAND_ROUTE_MULTIPLIER_BASE;
      }
    });
  });

  describe('routeMultiplierStep', () => {
    it('defaults to 0.1 when env not set', () => {
      expect(demandConfig.routeMultiplierStep).toBe(0.1);
    });
  });

  describe('next24HoursFactor', () => {
    it('defaults to 1.1 when env not set', () => {
      expect(demandConfig.next24HoursFactor).toBe(1.1);
    });
  });

  describe('next48HoursFactor', () => {
    it('defaults to 0.95 when env not set', () => {
      expect(demandConfig.next48HoursFactor).toBe(0.95);
    });
  });

  describe('peakHours', () => {
    it('defaults to morning and evening rush hours', () => {
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
    });

    it('parses a comma-separated list from env', () => {
      const original = process.env.DEMAND_PEAK_HOURS;
      process.env.DEMAND_PEAK_HOURS = '09:00-11:00,18:00-20:00';
      expect(demandConfig.peakHours).toEqual(['09:00-11:00', '18:00-20:00']);
      if (original !== undefined) {
        process.env.DEMAND_PEAK_HOURS = original;
      } else {
        delete process.env.DEMAND_PEAK_HOURS;
      }
    });

    it('returns default when env is empty string', () => {
      const original = process.env.DEMAND_PEAK_HOURS;
      process.env.DEMAND_PEAK_HOURS = '';
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
      if (original !== undefined) {
        process.env.DEMAND_PEAK_HOURS = original;
      } else {
        delete process.env.DEMAND_PEAK_HOURS;
      }
    });
  });
});
