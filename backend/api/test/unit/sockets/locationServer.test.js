import { describe, it, expect } from 'vitest';
import { getActiveDriverCount, parseGpsTimestamp } from '../../../src/sockets/locationServer.js';

describe('locationServer Socket', () => {
  it('returns active driver count', () => {
    expect(typeof getActiveDriverCount()).toBe('number');
  });
});

describe('parseGpsTimestamp', () => {
  it('falls back to the current time for missing timestamps', () => {
    for (const bad of [undefined, null, '']) {
      const ts = parseGpsTimestamp(bad);
      expect(Number.isNaN(ts.getTime())).toBe(false);
    }
  });

  it('falls back to the current time for malformed timestamps', () => {
    for (const bad of ['abc', '0', 'not-a-date', '2026-13-99T99:99:99Z']) {
      const ts = parseGpsTimestamp(bad);
      expect(Number.isNaN(ts.getTime())).toBe(false);
    }
  });

  it('preserves valid timestamps', () => {
    const ts = parseGpsTimestamp('2026-01-01T12:00:00.000Z');
    expect(ts.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('issue #8980 regression — locationServer catch block logging compliance', () => {
  it('ensures locationServer.js contains no bare catch blocks and uses structured logger in error handling', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileUrl = new URL('../../../src/sockets/locationServer.js', import.meta.url);
    const content = fs.readFileSync(fileUrl, 'utf8');

    // 1. Verify no bare catch blocks (e.g. `catch {` or `catch\s*{`) exist in locationServer.js
    const bareCatchRegex = /catch\s*\{/g;
    const bareCatchMatches = content.match(bareCatchRegex);
    expect(bareCatchMatches).toBeNull();

    // 2. Verify all catch blocks bind an error parameter (e.g. `catch (err)` or `catch (error)`)
    const catchBlockRegex = /catch\s*\(([^)]+)\)/g;
    const catchMatches = [...content.matchAll(catchBlockRegex)];
    expect(catchMatches.length).toBeGreaterThan(0);

    // 3. Verify structured logger import exists
    expect(content).toMatch(/import\s+logger\s+from\s+["']\.\.\/middleware\/logger\.js["']/);

    // 4. Verify logger.error is invoked within error handling paths
    expect(content).toMatch(/logger\.error\(/);
  });
});
