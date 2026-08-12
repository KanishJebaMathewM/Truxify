/**
 * Syntax-gate regression test for GitHub issue #8892.
 *
 * `backend/api/src/services/order/deliveryVerificationService.js` previously
 * failed to parse — `node --check` reported `SyntaxError: Unexpected strict
 * mode reserved word` in the escrow-amount resolution region (lines ~489-542
 * and ~601-608) due to a botched refactor with duplicated/orphaned `let`
 * declarations. Because the module could not be constructed, every importer
 * broke: `orderRoutes.js` (confirm-OTP / verify-delivery handlers) and
 * `core/container.js` (DeliveryVerificationService) both failed at load time,
 * taking down delivery verification and the OTP-confirm flow.
 *
 * This test locks the fix in place:
 *   1. Runs `node --check` on the module so a parse error fails CI.
 *   2. Asserts the refactored escrow-amount bindings are each declared exactly
 *      once, so the duplicated/orphaned `let` declarations cannot silently
 *      return.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceFile = path.resolve(__dirname, '../../src/services/order/deliveryVerificationService.js');

function occurrences(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

describe('deliveryVerificationService.js syntax (issue #8892)', () => {
  it('module parses cleanly under `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', serviceFile], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('escrow-amount refactor bindings are each declared exactly once', () => {
    const source = readFileSync(serviceFile, 'utf8');

    for (const binding of [
      'let expectedAmountWei',
      'let releaseTxHash',
      'let escrowAlreadyReleased',
    ]) {
      expect(
        occurrences(source, new RegExp(binding, 'g')),
        `${binding} must be declared exactly once (no duplicated/orphaned let)`,
      ).toBe(1);
    }
  });

  it('expectedAmountWei is declared via a single `let expectedAmountWei = null;`', () => {
    const source = readFileSync(serviceFile, 'utf8');
    expect(occurrences(source, /let expectedAmountWei = null;/g)).toBe(1);
  });
});
