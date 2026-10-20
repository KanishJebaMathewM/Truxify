import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));
vi.mock('../../src/services/order/deliveryVerificationService.js', () => ({
  default: {},
}));

const worker = await import('../../src/services/iotTelemetryWorker.js');
const { registerCargoSLA, ingestTelemetryFrame, getLoadTelemetryHistory } = worker;

let n = 0;
const load = () => `LOAD-${++n}-${Date.now()}`;
const frame = (loadId, t, extra = {}) => ({ loadId, temperatureCelsius: t, ...extra });

describe('iotTelemetryWorker SLA windows', () => {
  it('rejects frames without a loadId or numeric temperature', async () => {
    await expect(ingestTelemetryFrame({ temperatureCelsius: 5 })).rejects.toThrow(/loadId/);
    await expect(ingestTelemetryFrame({ loadId: 'L1', temperatureCelsius: 'hot' })).rejects.toThrow();
  });

  it('in-range frames are COMPLIANT with a computed MKT', async () => {
    const id = load();
    const res = await ingestTelemetryFrame(frame(id, 5));
    expect(res.slaStatus).toBe('COMPLIANT');
    expect(res.currentMktCelsius).toBeCloseTo(5, 1);
    expect(res.isCriticalBreach).toBe(false);
  });

  it('a single out-of-range reading is WARNING, not a breach', async () => {
    const id = load();
    registerCargoSLA(id, { minTempCelsius: 2, maxTempCelsius: 8, maxExcursionMinutes: 5 });
    const res = await ingestTelemetryFrame(frame(id, 12));
    expect(res.slaStatus).toBe('WARNING');
    expect(res.excursionMinutes).toBe(1);
    expect(res.isCriticalBreach).toBe(false);
  });

  it('excursions past maxExcursionMinutes are CRITICAL_BREACH', async () => {
    const id = load();
    registerCargoSLA(id, { minTempCelsius: 2, maxTempCelsius: 8, maxExcursionMinutes: 2 });
    await ingestTelemetryFrame(frame(id, 12));
    await ingestTelemetryFrame(frame(id, 13));
    const res = await ingestTelemetryFrame(frame(id, 12));
    expect(res.isCriticalBreach).toBe(true);
    expect(res.slaStatus).toBe('CRITICAL_BREACH');
  });

  it('shock over maxShockG breaches immediately', async () => {
    const id = load();
    registerCargoSLA(id, { maxShockG: 2.0, maxExcursionMinutes: 99 });
    const res = await ingestTelemetryFrame(frame(id, 5, { shockVibrationG: 4.5 }));
    expect(res.isCriticalBreach).toBe(true);
    expect(res.peakShockG).toBe(4.5);
  });

  it('door-open events are counted in the window', async () => {
    const id = load();
    await ingestTelemetryFrame(frame(id, 5, { doorOpen: true }));
    const res = await ingestTelemetryFrame(frame(id, 5, { doorOpen: true }));
    expect(res.doorOpenEventsInWindow).toBe(2);
  });

  it('telemetry history is retrievable per load', async () => {
    const id = load();
    await ingestTelemetryFrame(frame(id, 4));
    await ingestTelemetryFrame(frame(id, 6));
    const hist = getLoadTelemetryHistory(id);
    expect(hist.length).toBe(2);
    expect(hist[0].temperature).toBe(4);
  });

  it('SLA registration applies custom thresholds', async () => {
    const id = load();
    registerCargoSLA(id, { minTempCelsius: 0, maxTempCelsius: 4, maxExcursionMinutes: 0, maxShockG: 9 });
    const res = await ingestTelemetryFrame(frame(id, 6)); // above custom max 4, threshold 0
    expect(res.isCriticalBreach).toBe(true);
    expect(res.maxAllowedExcursionMins).toBe(0);
  });
});
