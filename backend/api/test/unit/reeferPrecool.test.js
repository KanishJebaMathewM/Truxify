import { describe, it, expect } from 'vitest';
import { evaluateReeferPrecooling } from '../../src/services/reeferPrecool.js';

describe('reeferPrecool service', () => {
  it('triggers precooling in CONTINUOUS_PULLDOWN mode when ambient temp is >= 85°F', () => {
    const result = evaluateReeferPrecooling({
      reeferId: 'REEFER-01',
      etaMinutes: 60,
      targetCargoTempF: -10,
      currentReeferTempF: 75,
      ambientWeatherTempF: 92
    });

    expect(result.reeferId).toBe('REEFER-01');
    expect(result.status).toBe('PRECOOL_ACTIVE');
    expect(result.telematicsCommand).not.toBeNull();
    expect(result.telematicsCommand.action).toBe('START_PRECOOLING');
    expect(result.telematicsCommand.targetSetPointF).toBe(-10);
    expect(result.telematicsCommand.mode).toBe('CONTINUOUS_PULLDOWN');
    expect(result.metrics.currentReeferTempF).toBe(75);
    expect(result.metrics.targetCargoTempF).toBe(-10);
  });

  it('triggers precooling in CYCLE_SENTRY mode when ambient temp is below 85°F', () => {
    const result = evaluateReeferPrecooling({
      reeferId: 'REEFER-02',
      etaMinutes: 45,
      targetCargoTempF: 34,
      currentReeferTempF: 65,
      ambientWeatherTempF: 72
    });

    expect(result.status).toBe('PRECOOL_ACTIVE');
    expect(result.telematicsCommand).not.toBeNull();
    expect(result.telematicsCommand.mode).toBe('CYCLE_SENTRY');
  });

  it('remains in STANDBY when ETA is safely beyond the required precool lead time', () => {
    const result = evaluateReeferPrecooling({
      reeferId: 'REEFER-03',
      etaMinutes: 300, // 5 hours away
      targetCargoTempF: 32,
      currentReeferTempF: 60,
      ambientWeatherTempF: 70
    });

    expect(result.status).toBe('STANDBY');
    expect(result.telematicsCommand).toBeNull();
  });

  it('reports AT_TEMPERATURE when reefer is already at or below target setpoint', () => {
    const result = evaluateReeferPrecooling({
      reeferId: 'REEFER-04',
      etaMinutes: 30,
      targetCargoTempF: 34,
      currentReeferTempF: 32,
      ambientWeatherTempF: 80
    });

    expect(result.status).toBe('AT_TEMPERATURE');
    expect(result.telematicsCommand).toBeNull();
  });

  it('handles default parameter options correctly', () => {
    const result = evaluateReeferPrecooling({});

    expect(result.metrics.etaMinutes).toBe(120);
    expect(result.metrics.targetCargoTempF).toBe(0);
    expect(result.metrics.currentReeferTempF).toBe(75);
  });
});
