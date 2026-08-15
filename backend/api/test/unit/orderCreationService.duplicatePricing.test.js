import { describe, it, expect } from 'vitest';

// Regression for #14875: orderCreationService.js declared `let pricing;` twice
// in the same scope (a stale merge leftover re-implemented the pricing block),
// so the module failed to evaluate with `SyntaxError: Identifier 'pricing' has
// already been declared`. `orderRoutes.js:159` statically imports
// `createOrder` from this module, so the failed load also broke every order
// route. This test imports the real module; on the broken revision the dynamic
// import rejects with a SyntaxError, on the fixed revision it resolves.

const mod = await import('../../src/services/order/orderCreationService.js');

describe('orderCreationService — duplicate `let pricing` regression (#14875)', () => {
  it('module imports without SyntaxError (duplicate pricing declaration removed)', () => {
    expect(typeof mod.createOrder).toBe('function');
  });

  it('declares `pricing` exactly once (no duplicate let)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../../src/services/order/orderCreationService.js', import.meta.url),
      'utf8',
    );
    // The canonical pricing block remains; the stale merge-leftover that
    // re-declared `let pricing;` is gone.
    const pricingDecls = (src.match(/^\s*let pricing;\s*$/gm) || []);
    expect(pricingDecls.length).toBe(1);
  });
});
