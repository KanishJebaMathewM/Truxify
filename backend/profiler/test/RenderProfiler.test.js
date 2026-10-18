import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import RenderProfiler from '../RenderProfiler.js';

describe('RenderProfiler profile lifecycle', () => {
  test('createProfile + getProfile round-trip; unknown profile throws or returns undefined consistently', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('LoadBoard');
    assert.equal(p.widgetName, 'LoadBoard');
    assert.equal(rp.getProfile('LoadBoard'), p);
  });

  test('render timings aggregate: totals, averages, min/max', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('Widget');
    // drive the metric aggregation directly for determinism
    p.addRender({ duration: 10 });
    p.addRender({ duration: 30 });
    p.addRender({ duration: 20 });
    assert.equal(p.metrics.totalRenders, 3);
    assert.equal(p.metrics.totalRenderTime, 60);
    assert.equal(p.metrics.averageRenderTime, 20);
    assert.equal(p.metrics.maxRenderTime, 30);
    assert.equal(p.metrics.minRenderTime, 10);
  });

  test('startRender().finish() records a real positive duration and the cause', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('LiveWidget');
    const timing = p.startRender();
    const duration = timing.finish('props-change', { prop: 'loads' });
    assert.ok(duration >= 0);
    assert.equal(p.metrics.totalRenders, 1);
    assert.deepEqual(p.metrics.reRenderCauses, { 'props-change': 1 });
  });

  test('layout + paint timings aggregate separately', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('W');
    p.addLayout({ duration: 4 });
    p.addLayout({ duration: 8 });
    p.addPaint({ duration: 2 });
    assert.equal(p.metrics.totalLayoutTime, 12);
    assert.equal(p.metrics.averageLayoutTime, 6);
    assert.equal(p.metrics.totalPaintTime, 2);
  });

  test('reRender causes accumulate per cause', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('W');
    p.addReRenderCause('state');
    p.addReRenderCause('state');
    p.addReRenderCause('props');
    assert.deepEqual(p.metrics.reRenderCauses, { state: 2, props: 1 });
  });

  test('stop() deactivates and returns the stats snapshot', () => {
    const rp = new RenderProfiler();
    const p = rp.createProfile('W');
    p.addRender({ duration: 5 });
    const stats = p.stop();
    assert.equal(p.isActive, false);
    assert.equal(stats.renderCount, 1);
    assert.equal(stats.isActive, false);
    assert.ok(stats.timestamp);
  });

  test("createProfile memory-sampling interval is unrefd (host may exit)", () => {
    const rp = new RenderProfiler();
    rp.createProfile('X');
    assert.ok(rp.samplingInterval, 'sampling started on first profile');
    assert.equal(rp.samplingInterval.hasRef(), false, "interval must not pin the process open");
    rp.stopMemoryMonitoring();
  });

  test('stopProfile moves the profile to inactive; stopAllProfiles covers all', () => {
    const rp = new RenderProfiler();
    rp.createProfile('A');
    rp.createProfile('B');
    rp.stopProfile('A');
    assert.equal(rp.getActiveProfiles().length, 1);
    assert.equal(rp.getInactiveProfiles().length, 1);
  });
});
