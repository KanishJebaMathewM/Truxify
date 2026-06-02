/**
 * Build a minimal Express app wired to the order router, with the supabase
 * client swapped out for an in-memory mock. The auth middleware is left in
 * place — tests use the existing BYPASS_AUTH=true path (set in the test
 * setup) and provide the `x-user-id` / `x-user-role` headers.
 *
 * Usage:
 *   import { createSupabaseMock } from './helpers/supabaseMock.js';
 *   import { buildTestApp } from './helpers/testApp.js';
 *
 *   const m = createSupabaseMock();
 *   vi.mock('../../src/config/db.js', () => ({ supabase: m.supabase }));
 *   const app = buildTestApp();
 *   ...
 */
import express from 'express';
import orderRoutes from '../../src/routes/orderRoutes.js';

export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRoutes);
  return app;
}
