import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the bad merge of `fix/wim-bypass-null-weight-fail-open`
 * into main (7a0a99b57). That merge interleaved the old client-weight handler
 * with the trusted-measurement handler inside POST /request-bypass:
 *
 *   - the module no longer parsed ("Missing catch or finally after try"), which
 *     takes down every importer, including src/index.js and so API startup;
 *   - even if it had parsed, the handler referenced identifiers that no longer
 *     existed (`measurement`, `isVerified`, `LBS_PER_TONNE`);
 *   - the signing-secret fail-closed check and the approved-document
 *     verification fallback from main were dropped.
 *
 * Behaviour (fail-closed on missing weights, BYPASS/PULL_IN signals) is covered
 * by test/integration/wimBypassMissingWeight.test.js; this suite pins the
 * structural properties that the merge destroyed and that a plain behavioural
 * test cannot report on because the module never loads.
 */
const routePath = fileURLToPath(new URL('../../src/routes/wimBypass.js', import.meta.url));
const source = readFileSync(routePath, 'utf8');

describe('routes/wimBypass.js merge integrity', () => {
  it('parses without running any module side effects', () => {
    const result = spawnSync(process.execPath, ['--check', routePath], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('declares each endpoint exactly once', () => {
    expect(source.match(/'\/request-bypass'/g)).toHaveLength(1);
    expect(source.match(/'\/verify-bypass'/g)).toHaveLength(1);
    expect(source.match(/export default router/g)).toHaveLength(1);
  });

  it('has no leftovers of the removed client-weight handler', () => {
    expect(source).not.toContain('LBS_PER_TONNE');
    expect(source).not.toMatch(/const (rawTruckCapacity|rawLoadWeight|maxWeightLimit|axleWeight|safetyScore)\b/);
    // `isVerified` must be declared (with let/const) wherever it is used.
    expect(source).toMatch(/let isVerified = /);
  });

  it('refuses to issue credentials without a signing secret, before any DB work', () => {
    const guard = source.indexOf('hasWimSigningSecret()');
    const firstQuery = source.indexOf(".from('trucks')");
    expect(guard).toBeGreaterThan(-1);
    expect(firstQuery).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstQuery);
  });

  it('keeps the approved-document fallback for driver verification', () => {
    expect(source).toContain(".from('driver_documents')");
  });

  it('rejects non-positive load weight and truck capacity, not just non-finite ones', () => {
    // Number(null) === 0 and Number.isFinite(0) === true, so isFinite alone
    // lets a load with no registered weight through as "weightless".
    expect(source).toMatch(/measurement\.weightLbs\s*<=\s*0/);
    expect(source).toMatch(/measurement\.capacityLbs\s*<=\s*0/);
  });

  it('derives eligibility inputs from the server-built measurement only', () => {
    const handler = source.slice(source.indexOf("'/request-bypass'"), source.indexOf("'/verify-bypass'"));
    expect(handler).toContain('buildTrustedMeasurement(');
    expect(handler).toMatch(/safetyScore:\s*measurement\.safetyScore/);
    expect(handler).toMatch(/axleWeight:\s*measurement\.weightLbs/);
    expect(handler).toMatch(/maxWeightLimit:\s*measurement\.capacityLbs/);
    // Client-supplied measurement fields must never feed eligibility.
    expect(handler).not.toMatch(/req\.body\.(safetyScore|axleWeight|maxWeightLimit)/);
  });
});
