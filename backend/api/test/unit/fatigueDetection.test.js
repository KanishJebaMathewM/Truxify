import { describe, it, expect } from 'vitest';
import { evaluateDriverFatigue } from '../../src/services/fatigueDetection.js';

describe('fatigueDetection service', () => {
  it('detects normal alertness when biometric indicators are low', () => {
    const result = evaluateDriverFatigue({
      driverId: 'driver-201',
      biometricData: {
        perclosScore: 0.05,
        blinkRatePerMin: 18,
        headNodCount: 0,
        averageEyeClosureMs: 250
      },
      hosRemainingMinutes: 480
    });

    expect(result.driverId).toBe('driver-201');
    expect(result.alertLevel).toBe('NORMAL');
    expect(result.requiresImmediateRest).toBe(false);
    expect(result.actionPrompt).toBe('Driver alertness optimal.');
    expect(result.recommendedRestStops).toEqual([]);
    expect(result.fatigueMetrics.fatigueScore).toBe(0);
  });

  it('detects moderate drowsiness when PERCLOS and eye closures are elevated', () => {
    const result = evaluateDriverFatigue({
      driverId: 'driver-202',
      biometricData: {
        perclosScore: 0.12, // +0.25
        averageEyeClosureMs: 400 // +0.15 => total 0.40
      },
      hosRemainingMinutes: 300
    });

    expect(result.alertLevel).toBe('MODERATE_DROWSINESS');
    expect(result.requiresImmediateRest).toBe(false);
    expect(result.actionPrompt).toContain('WARNING: Early signs of fatigue detected');
    expect(result.recommendedRestStops.length).toBeGreaterThan(0);
    expect(result.recommendedRestStops[0]).toHaveProperty('estimatedDriveTimeMinutes');
  });

  it('triggers critical fatigue when fatigueScore exceeds 0.65', () => {
    const result = evaluateDriverFatigue({
      driverId: 'driver-203',
      biometricData: {
        perclosScore: 0.16, // +0.45
        headNodCount: 2 // +0.30 => total 0.75
      },
      hosRemainingMinutes: 400
    });

    expect(result.alertLevel).toBe('CRITICAL_FATIGUE');
    expect(result.requiresImmediateRest).toBe(true);
    expect(result.actionPrompt).toContain('CRITICAL ALERT: Biometric fatigue detected');
    expect(result.recommendedRestStops.length).toBeGreaterThan(0);
  });

  it('triggers critical fatigue when fatigueScore is >= 0.45 and HOS is under 90 minutes', () => {
    const result = evaluateDriverFatigue({
      driverId: 'driver-204',
      biometricData: {
        perclosScore: 0.15 // +0.45
      },
      hosRemainingMinutes: 60 // <= 90 mins triggers critical
    });

    expect(result.alertLevel).toBe('CRITICAL_FATIGUE');
    expect(result.requiresImmediateRest).toBe(true);
  });

  it('provides default telemetry values when parameters are empty', () => {
    const result = evaluateDriverFatigue({});

    expect(result.alertLevel).toBe('NORMAL');
    expect(result.requiresImmediateRest).toBe(false);
    expect(result.fatigueMetrics.hosRemainingMinutes).toBe(600);
  });
});
