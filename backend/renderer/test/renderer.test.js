import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import FrameBuffer from '../FrameBuffer.js';
import DirtyRenderer from '../DirtyRenderer.js';

describe('FrameBuffer', () => {
  test('buffer dimensions + blank init', () => {
    const fb = new FrameBuffer(10, 4);
    assert.equal(fb.buffer.length, 4);
    assert.equal(fb.buffer[0].length, 10);
    assert.equal(fb.getPixel(0, 0).char, ' ');
  });

  test('setPixel writes and reports change; identical write reports no change', () => {
    const fb = new FrameBuffer(10, 4);
    assert.equal(fb.setPixel(2, 1, 'X'), true);
    assert.equal(fb.getPixel(2, 1).char, 'X');
    assert.equal(fb.setPixel(2, 1, 'X'), false, 'idempotent write is not a change');
  });

  test('out-of-bounds writes are rejected without throwing', () => {
    const fb = new FrameBuffer(5, 3);
    assert.equal(fb.setPixel(-1, 0, 'X'), false);
    assert.equal(fb.setPixel(0, 99, 'X'), false);
    assert.equal(fb.setPixel(99, 0, 'X'), false);
  });

  test('style changes count as changes (fg/bg/style)', () => {
    const fb = new FrameBuffer(5, 3);
    fb.setPixel(0, 0, 'A');
    assert.equal(fb.setPixel(0, 0, 'A', 'red'), true, 'fg change counts');
    assert.equal(fb.setPixel(0, 0, 'A', 'red'), false);
    assert.equal(fb.setPixel(0, 0, 'A', 'red', 'blue', 'bold'), true, 'style change counts');
  });

  test('setRow + getRow round-trip', () => {
    const fb = new FrameBuffer(5, 3);
    const row = Array.from({ length: 5 }, (_, i) => ({ char: String(i), fg: null, bg: null, style: null }));
    fb.setRow(1, row);
    assert.equal(fb.getRow(1)[3].char, '3');
  });

  test('clone is deep (mutating the clone does not touch the source)', () => {
    const fb = new FrameBuffer(4, 2);
    fb.setPixel(1, 1, 'Z');
    const c = fb.clone();
    c.setPixel(1, 1, 'Q');
    assert.equal(fb.getPixel(1, 1).char, 'Z');
  });

  test('dirty rects: written pixel marks a dirty rect; clearDirtyRects empties', () => {
    const fb = new FrameBuffer(10, 5);
    fb.clearDirtyRects();
    fb.setPixel(3, 2, 'X');
    assert.ok(fb.getDirtyRects().length >= 1);
    fb.clearDirtyRects();
    assert.equal(fb.getDirtyRects().length, 0);
  });

  test('rect overlap + merge geometry', () => {
    const fb = new FrameBuffer(10, 5);
    assert.equal(fb.rectsOverlap({ x: 0, y: 0, width: 2, height: 2 }, { x: 1, y: 1, width: 2, height: 2 }), true);
    assert.equal(fb.rectsOverlap({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 4, width: 1, height: 1 }), false);
    // mergeRects mutates `a` in place and returns nothing
    const a = { x: 0, y: 0, width: 2, height: 2 };
    const ret = fb.mergeRects(a, { x: 3, y: 1, width: 2, height: 2 });
    assert.equal(ret, undefined);
    assert.deepEqual(a, { x: 0, y: 0, width: 5, height: 3 });
  });
});

describe('DirtyRenderer', () => {
  test('first render is a full frame; no-change render returns empty output', () => {
    const r = new DirtyRenderer(20, 6);
    r.setPixel(0, 0, 'A');
    const first = r.render();
    assert.ok(first.length > 0, 'first frame renders');
    assert.equal(r.stats.fullFrames, 1);
    const second = r.render();
    assert.equal(second, '', 'no changes → empty output');
  });

  test('a single-pixel change renders as a dirty (partial) frame', () => {
    const r = new DirtyRenderer(20, 6);
    r.render(); // initial full frame
    r.setPixel(5, 2, 'B');
    const out = r.render();
    assert.ok(out.length > 0);
    assert.equal(r.stats.dirtyFrames, 1);
  });

  test('>20 dirty rects escalates to a full render', () => {
    const r = new DirtyRenderer(40, 10);
    r.setPixel(0, 0, 'A');
    r.render(); // contentful first frame → full render (fullFrames = 1)
    assert.equal(r.stats.fullFrames, 1);
    for (let i = 0; i < 25; i++) r.setPixel(i % 40, Math.floor(i / 40) + 5, 'X');
    const out = r.render();
    assert.ok(out.length > 0);
    assert.equal(r.stats.fullFrames, 2, 'the >20-rect frame escalated to full');
  });

  test('disabled renderer passes writes through without dirty tracking', () => {
    const r = new DirtyRenderer(10, 4);
    r.isEnabled = false;
    assert.equal(r.setPixel(1, 1, 'Q'), true);
    assert.equal(r.dirtyRects.length, 0);
  });

  test('markDirty clamps out-of-bounds rects and ignores empty ones', () => {
    const r = new DirtyRenderer(10, 4);
    r.dirtyRects = [];
    r.markDirty(-5, -5, 3, 3); // fully out of bounds → ignored (pre-fix this
    assert.equal(r.dirtyRects.length, 0); // teleported to a visible 3x3!)
    r.markDirty(-1, 1, 3, 2); // partially clipped: intersects as (0,1,2,2)
    assert.deepEqual(r.dirtyRects[0], { x: 0, y: 1, width: 2, height: 2 });
    r.markDirty(8, 2, 10, 10); // clamps to the remaining 2x2
    assert.deepEqual(r.dirtyRects[1], { x: 8, y: 2, width: 2, height: 2 });
  });

  test('overlapping dirty rects merge into fewer rects', () => {
    const r = new DirtyRenderer(20, 8);
    r.dirtyRects = [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 15, y: 6, width: 2, height: 2 },
    ];
    const merged = r.mergeDirtyRects();
    assert.ok(merged.length < 3, `expected a merge, got ${merged.length} rects`);
    assert.ok(merged.some((m) => m.x === 15 && m.y === 6), 'disjoint rect survives');
  });

  test('render stats accumulate across frames', () => {
    const r = new DirtyRenderer(10, 4);
    r.setPixel(0, 0, 'A');
    r.render();
    r.setPixel(1, 1, 'B');
    r.render();
    assert.equal(r.stats.frames, 2);
    assert.ok(r.stats.totalCharsWritten > 0);
    assert.ok(r.stats.avgRectsPerFrame >= 0);
  });
});
