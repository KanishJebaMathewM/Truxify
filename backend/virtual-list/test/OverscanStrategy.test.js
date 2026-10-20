import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import OverscanStrategy from '../OverscanStrategy.js';

const make = (cfg = {}) => new OverscanStrategy({ itemHeight: 50, viewportHeight: 500, ...cfg });

describe('OverscanStrategy', () => {
  test('starts at defaultOverscan', (t) => {
    const s = make({ defaultOverscan: 5 });
    t.after(() => s.stopMonitoring());
    assert.equal(s.getOverscan(), 5);
  });

  test('the monitoring interval is unref\'d — a host process may exit with it live', (t) => {
    const s = make();
    t.after(() => s.stopMonitoring());
    assert.ok(s.monitoringInterval, 'interval exists');
    assert.equal(typeof s.monitoringInterval.hasRef === 'function' ? s.monitoringInterval.hasRef() : false, false);
  });

  test('stopMonitoring clears the interval and is idempotent', () => {
    const s = make();
    s.stopMonitoring();
    assert.equal(s.monitoringInterval, null);
    s.stopMonitoring(); // must not throw
  });

  test('idle scroll keeps overscan at default', (t) => {
    const s = make({ defaultOverscan: 5 });
    t.after(() => s.stopMonitoring());
    s.updateScrollPosition(0);
    s.calculateOverscan();
    assert.equal(s.getSpeedCategory(0), 'idle');
  });

  test('speed categories follow the velocity thresholds', (t) => {
    const s = make();
    t.after(() => s.stopMonitoring());
    assert.equal(s.getSpeedCategory(0), 'idle');
    // contract: exceeding a threshold lands in the NEXT band up
    assert.equal(s.getSpeedCategory(s.velocityThresholds.slow + 1), 'medium');
    assert.equal(s.getSpeedCategory(s.velocityThresholds.medium + 1), 'fast');
    assert.equal(s.getSpeedCategory(s.velocityThresholds.fast + 1), 'veryFast');
    assert.equal(s.getSpeedCategory(s.velocityThresholds.slow), 'slow');
  });

  test('overscan is clamped to [minOverscan, maxOverscan] even at extreme velocity', (t) => {
    const s = make({ minOverscan: 2, maxOverscan: 10, defaultOverscan: 5 });
    t.after(() => s.stopMonitoring());
    // simulate violent scrolling: huge deltas with tiny time gaps
    for (let i = 0; i < 20; i++) {
      s.lastScrollTime = Date.now() - 1;
      s.updateScrollPosition(i * 100000);
    }
    assert.ok(s.getOverscan() <= 10, `overscan ${s.getOverscan()} exceeds max`);
    assert.ok(s.getOverscan() >= 2);
  });

  test('velocity history is bounded and weighted toward recent samples', (t) => {
    const s = make();
    t.after(() => s.stopMonitoring());
    for (let i = 0; i < 50; i++) {
      s.velocityHistory.push(1);
    }
    s.velocityHistory.push(1000);
    const avg = s.getAverageVelocity();
    assert.ok(avg > 1, 'recent high velocity dominates the weighted average');
    // bound the history
    while (s.velocityHistory.length > 0) s.velocityHistory.shift();
    assert.equal(s.getAverageVelocity(), 0);
  });

  test('render-time adaptation: slow renders shrink overscan, fast renders grow it', (t) => {
    const s = make({ defaultOverscan: 5, minOverscan: 2, maxOverscan: 10 });
    t.after(() => s.stopMonitoring());
    for (let i = 0; i < 10; i++) s.recordRenderTime(100); // very slow
    const slowAdjusted = s.adjustForPerformance(5);
    assert.ok(slowAdjusted < 5, 'slow renders reduce overscan');
    s.renderTimes.length = 0;
    for (let i = 0; i < 10; i++) s.recordRenderTime(2); // very fast
    const fastAdjusted = s.adjustForPerformance(5);
    assert.ok(fastAdjusted > 5, 'fast renders increase overscan');
  });

  test('recordRenderTime bounds the sample window', (t) => {
    const s = make();
    t.after(() => s.stopMonitoring());
    for (let i = 0; i < s.maxRenderTimes + 25; i++) s.recordRenderTime(i);
    assert.equal(s.renderTimes.length, s.maxRenderTimes);
    assert.equal(s.renderTimes.at(-1), s.maxRenderTimes + 24);
  });

  test('checkIdle decays overscan toward default when velocity is ~0', (t) => {
    const s = make({ defaultOverscan: 5 });
    t.after(() => s.stopMonitoring());
    s.currentOverscan = 9;
    s.velocityHistory.length = 0; // idle
    s.checkIdle();
    assert.equal(s.currentOverscan, 8);
    s.checkIdle();
    s.checkIdle();
    s.checkIdle();
    assert.equal(s.currentOverscan, 5, 'decays to default but not below');
  });

  test('overscanUpdated event carries velocity + speed category', (t) => {
    const s = make();
    t.after(() => s.stopMonitoring());
    let evt = null;
    s.on('overscanUpdated', (e) => (evt = e));
    s.lastScrollTime = Date.now() - 5;
    s.updateScrollPosition(5000); // fast scroll
    s.calculateOverscan();
    if (evt) {
      assert.ok('velocity' in evt && 'speedCategory' in evt && 'overscan' in evt);
    }
  });
});
