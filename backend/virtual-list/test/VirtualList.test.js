import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import VirtualList from '../VirtualList.js';

const makeItems = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `Load ${i + 1}` }));

describe('VirtualList', () => {
  test('constructor defaults + config', () => {
    const list = new VirtualList({ items: makeItems(100), itemHeight: 40, viewportHeight: 400 });
    assert.equal(list.items.length, 100);
    assert.equal(list.itemHeight, 40);
    assert.equal(list.viewportHeight, 400);
    assert.equal(list.scrollPosition, 0);
  });

  test('scrollTo clamps into [0, totalHeight - viewportHeight]', () => {
    const list = new VirtualList({ items: makeItems(100), itemHeight: 50, viewportHeight: 500 });
    assert.equal(list.scrollTo(-100), 0);
    assert.equal(list.scrollTo(10_000), 100 * 50 - 500);
    assert.equal(list.scrollTo(250), 250);
  });

  test('scrollBy is relative; scrollToIndex maps through itemHeight', () => {
    const list = new VirtualList({ items: makeItems(50), itemHeight: 50, viewportHeight: 200 });
    list.scrollTo(100);
    assert.equal(list.scrollBy(50), 150);
    assert.equal(list.scrollToIndex(10), 500);
  });

  test('updateVisibleRange computes viewport + overscan-bounded render range', () => {
    const list = new VirtualList({ items: makeItems(100), itemHeight: 50, viewportHeight: 200, defaultOverscan: 5 });
    list.scrollTo(500); // viewport starts at index 10
    const range = list.updateVisibleRange();
    assert.equal(range.viewportStart, 10);
    assert.equal(range.viewportEnd, 14); // ceil(200/50) = 4 visible
    assert.ok(range.start <= range.viewportStart, 'render range extends above viewport');
    assert.ok(range.end >= range.viewportEnd, 'render range extends below viewport');
    assert.ok(range.start >= 0 && range.end <= 99);
  });

  test('render() returns positioned items with isVisible flags', () => {
    const list = new VirtualList({ items: makeItems(30), itemHeight: 50, viewportHeight: 200 });
    list.updateVisibleRange();
    const rendered = list.render();
    assert.ok(Array.isArray(rendered) && rendered.length > 0);
    for (const r of rendered) {
      assert.equal(r.position, r.index * 50);
      assert.equal(r.height, 50);
      assert.equal(typeof r.isVisible, 'boolean');
    }
    // viewportEnd is inclusive: ceil(200/50) = 4 → indices 0..4 visible
    const visible = rendered.filter((r) => r.isVisible);
    assert.deepEqual(visible.map((r) => r.index), [0, 1, 2, 3, 4]);
  });

  test('render() is reentrancy-guarded (returns null while rendering)', () => {
    const list = new VirtualList({ items: makeItems(10) });
    list.updateVisibleRange();
    list.isRendering = true;
    assert.equal(list.render(), null);
  });

  test('item mutations keep indices consistent', () => {
    const list = new VirtualList({ items: makeItems(5), itemHeight: 50, viewportHeight: 200 });
    list.addItem({ id: 6, label: 'Load 6' });
    assert.equal(list.items.length, 6);
    list.insertItem(0, { id: 0, label: 'Load 0' });
    assert.equal(list.items[0].id, 0);
    assert.equal(list.items.length, 7);
    list.updateItem(0, { id: 0, label: 'Updated' });
    assert.equal(list.items[0].label, 'Updated');
    list.removeItem(0);
    assert.equal(list.items.length, 6);
    assert.equal(list.items[0].id, 1);
    list.setItems(makeItems(3));
    assert.equal(list.items.length, 3);
    list.clearItems();
    assert.equal(list.items.length, 0);
  });

  test('geometry helpers are inverse-consistent', () => {
    const list = new VirtualList({ items: makeItems(40), itemHeight: 25, viewportHeight: 100 });
    assert.equal(list.getTotalHeight(), 1000);
    assert.equal(list.getIndexAtPosition(250), 10);
    assert.equal(list.getPositionAtIndex(10), 250);
    assert.equal(list.getItemAt(7).id, 8);
  });

  test('emits scroll + rangeUpdated events', () => {
    const list = new VirtualList({ items: makeItems(50), itemHeight: 50, viewportHeight: 200 });
    let scrolled = null;
    let ranged = null;
    list.on('scroll', (e) => (scrolled = e));
    list.on('rangeUpdated', (r) => (ranged = r));
    list.scrollTo(300);
    assert.deepEqual(scrolled, { position: 300 });
    assert.ok(ranged && typeof ranged.viewportStart === 'number');
  });

  test('render stats accumulate', () => {
    const list = new VirtualList({ items: makeItems(20) });
    list.updateVisibleRange();
    list.render();
    list.render();
    const stats = list.getRenderStats();
    assert.equal(stats.renderCount, 2);
    assert.equal(stats.metrics.totalRenders, 2);
    assert.ok(stats.metrics.averageRenderTime >= 0);
  });
});
