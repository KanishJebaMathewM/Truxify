import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildSummary,
  parseOpenApiRpcFunctions,
  parseRequiredTables,
} from '../../scripts/verify-db-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('verify-db-schema script helpers', () => {
  it('extracts table names from the schema ER diagram definitions', () => {
    const schema = `
erDiagram
    profiles {
        uuid id PK
    }

    orders {
        uuid id PK
    }

    profiles ||--o{ orders : "customer_id"
`;

    expect(parseRequiredTables(schema)).toEqual(['profiles', 'orders']);
  });

  it('extracts RPC names from PostgREST OpenAPI paths', () => {
    const functions = parseOpenApiRpcFunctions({
      paths: {
        '/profiles': {},
        '/rpc/accept_bid_tx': {},
        '/rpc/withdraw_funds_tx': {},
      },
    });

    expect(functions).toEqual(new Set(['accept_bid_tx', 'withdraw_funds_tx']));
  });

  it('summarizes missing tables and functions', () => {
    const summary = buildSummary(
      [
        { name: 'profiles', ok: true },
        { name: 'orders', ok: false },
      ],
      [
        { name: 'accept_bid_tx', ok: true },
        { name: 'submit_rating_tx', ok: false },
      ]
    );

    expect(summary).toEqual({
      tablesChecked: 2,
      missingTables: 1,
      functionsChecked: 2,
      missingFunctions: 1,
    });
  });
});

describe('Database Schema Constraints and RPC Upsert validation in supabase_setup.sql', () => {
  it('contains the unique constraint on earnings_daily(driver_id, day_date)', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');
    
    // Check for table creation unique constraint
    const hasUniqueConstraint = /constraint\s+earnings_daily_driver_day_unique\s+unique\s*\(\s*driver_id\s*,\s*day_date\s*\)/i.test(sqlContent);
    expect(hasUniqueConstraint).toBe(true);
  });

  it('verifies that complete_trip_tx uses UPSERT behavior with ON CONFLICT', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');

    // Find all insert statements into earnings_daily in complete_trip_tx function definitions
    // and ensure they have ON CONFLICT (driver_id, day_date) DO UPDATE
    const insertMatches = [...sqlContent.matchAll(/insert\s+into\s+earnings_daily[\s\S]*?on\s+conflict\s*\(\s*driver_id\s*,\s*day_date\s*\)\s*do\s+update/gi)];
    
    // There should be at least two such insert statements matching the upsert behavior across the RPC overloads
    expect(insertMatches.length).toBeGreaterThanOrEqual(2);
  });
});
