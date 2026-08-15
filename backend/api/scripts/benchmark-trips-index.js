#!/usr/bin/env node
/**
 * benchmark-trips-index.js
 *
 * Before/after EXPLAIN ANALYZE harness for the trips table composite index.
 * Modelled on scripts/benchmark-postgis.js.
 *
 * Usage:
 *   node scripts/benchmark-trips-index.js [--trips <n>]
 *
 * Options:
 *   --trips <n>   Number of synthetic completed trips to seed (default 5000)
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 * The script seeds a synthetic driver, runs EXPLAIN ANALYZE on each hot
 * query shape, reports the plan differences, and cleans up after itself.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse CLI args
const args = process.argv.slice(2);
const tripCount = parseInt(args[args.indexOf('--trips') + 1] ?? '5000', 10) || 5000;

// Synthetic driver ID used for all seeded rows — cleaned up at the end.
const SYNTHETIC_DRIVER_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Hot query shapes from driverRoutes.js
// ---------------------------------------------------------------------------

const QUERY_SHAPES = [
  {
    label: 'Q1 — driver + status=completed + trip_date >= cutoff, ORDER BY trip_date DESC (line 1477)',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT *
      FROM trips
      WHERE driver_id   = '${SYNTHETIC_DRIVER_ID}'
        AND status      = 'completed'
        AND trip_date  >= NOW() - INTERVAL '90 days'
      ORDER BY trip_date DESC;
    `,
  },
  {
    label: 'Q2 — driver + status=completed, count only (line 1489)',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT COUNT(*)
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND status    = 'completed';
    `,
  },
  {
    label: 'Q3 — driver + status=completed, ORDER BY trip_date ASC (line 1531)',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT *
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND status    = 'completed'
      ORDER BY trip_date ASC;
    `,
  },
  {
    label: 'Q4 — driver_id filter only (lines 558, 813)',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT *
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}';
    `,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sql(query) {
  const { data, error } = await supabase.rpc('exec_sql', { query });
  if (error) throw new Error(`SQL error: ${error.message}\nQuery: ${query}`);
  return data;
}

function extractPlanNodes(explainText) {
  const lines = (explainText ?? '').split('\n');
  const nodes = lines
    .filter((l) => /->|Seq Scan|Index Scan|Bitmap|Sort/.test(l))
    .map((l) => l.trim());
  return nodes;
}

function extractExecutionTime(explainText) {
  const match = explainText.match(/Execution Time:\s*([\d.]+)\s*ms/);
  return match ? parseFloat(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Seed / cleanup
// ---------------------------------------------------------------------------

async function seedTrips() {
  console.log(`\nSeeding ${tripCount} synthetic completed trips for driver ${SYNTHETIC_DRIVER_ID}…`);

  // Build bulk insert using VALUES rows
  const rows = Array.from({ length: tripCount }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 365);
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    return `('${SYNTHETIC_DRIVER_ID}', 'completed', '${date}', 'BM-BENCH-${i.toString().padStart(6, '0')}')`;
  });

  // Insert in batches of 500 to avoid request-size limits
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).join(',\n');
    await sql(`
      INSERT INTO trips (driver_id, status, trip_date, trip_display_id)
      VALUES ${batch}
      ON CONFLICT DO NOTHING;
    `);
  }
  console.log(`Seeded ${tripCount} rows.`);
}

async function cleanup() {
  await sql(`DELETE FROM trips WHERE driver_id = '${SYNTHETIC_DRIVER_ID}';`);
  console.log('\nSynthetic rows removed.');
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function runQueryBenchmark(shape) {
  const result = await sql(shape.sql);
  const planText = Array.isArray(result)
    ? result.map((r) => Object.values(r)[0]).join('\n')
    : String(result);

  const execMs = extractExecutionTime(planText);
  const nodes  = extractPlanNodes(planText);

  return { label: shape.label, execMs, nodes, planText };
}

function printResult(result) {
  console.log(`\n  ${result.label}`);
  console.log(`  Execution time : ${result.execMs != null ? `${result.execMs} ms` : 'n/a'}`);
  console.log(`  Key plan nodes :`);
  if (result.nodes.length === 0) {
    console.log('    (none extracted)');
  } else {
    for (const node of result.nodes) {
      console.log(`    ${node}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('--- Trips Composite Index Benchmark ---');
  console.log(`Trip rows to seed: ${tripCount}`);

  // Check that the exec_sql RPC exists (requires a helper function in Supabase).
  // If it does not, print guidance and exit gracefully.
  try {
    await sql('SELECT 1');
  } catch (err) {
    console.error('\nCould not run raw SQL via exec_sql RPC.');
    console.error('Create a service-role helper first:\n');
    console.error(`
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result json;
BEGIN
  EXECUTE query INTO result;
  RETURN result;
END;
$$;
`);
    process.exit(1);
  }

  await seedTrips();

  // Run benchmarks
  console.log('\n=== EXPLAIN ANALYZE results ===');
  for (const shape of QUERY_SHAPES) {
    try {
      const result = await runQueryBenchmark(shape);
      printResult(result);

      // Flag if a sequential scan or sort appears — indicates the index is missing.
      const hasBadNode = result.nodes.some((n) => /Seq Scan|Sort/.test(n));
      if (hasBadNode) {
        console.log('  ⚠ WARNING: Seq Scan or Sort node detected — composite index may be missing.');
      } else {
        console.log('  ✓ Index scan confirmed — no sort node.');
      }
    } catch (err) {
      console.error(`  ✖ ${shape.label}: ${err.message}`);
    }
  }

  console.log('\nExpectations (with composite index on (driver_id, status, trip_date DESC)):');
  console.log('  Q1/Q3 : Index Scan using idx_trips_driver_status_date — no Sort node');
  console.log('  Q2    : Index Only Scan or Index Scan — no Bitmap AND, no Sort');
  console.log('  Q4    : Index Scan using idx_trips_driver_status_date (leading column)');

  await cleanup();
}

main().catch((err) => {
  console.error(`Benchmark failed: ${err.message}`);
  process.exitCode = 1;
});
