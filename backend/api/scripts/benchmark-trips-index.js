#!/usr/bin/env node

/**
 * benchmark-trips-index.js
 *
 * Before/after benchmark harness for the trips composite index.
 *
 * Usage:
 *   node scripts/benchmark-trips-index.js
 *   node scripts/benchmark-trips-index.js --trips 10000
 *
 * Environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The script:
 *   1. Verifies database connectivity.
 *   2. Removes any previous synthetic benchmark rows.
 *   3. Seeds synthetic completed trips.
 *   4. Runs EXPLAIN ANALYZE against hot query shapes.
 *   5. Reports execution time and important plan nodes.
 *   6. Always cleans up synthetic rows before exiting.
 *
 * IMPORTANT:
 *   This script requires an exec_sql PostgreSQL RPC function.
 *   That function must be restricted appropriately because it executes
 *   arbitrary SQL and should NEVER be exposed to untrusted clients.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function getTripCount() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--trips');

  if (index === -1) {
    return 5000;
  }

  const value = Number.parseInt(args[index + 1], 10);

  if (!Number.isInteger(value) || value <= 0) {
    console.error('Invalid --trips value. It must be a positive integer.');
    process.exit(1);
  }

  return value;
}

const tripCount = getTripCount();

// ---------------------------------------------------------------------------
// Synthetic benchmark identity
// ---------------------------------------------------------------------------
//
// This UUID must NOT belong to a real driver.
//

const SYNTHETIC_DRIVER_ID =
  '00000000-0000-0000-0000-000000000001';

const BENCHMARK_PREFIX = 'BM-BENCH-';

// ---------------------------------------------------------------------------
// Hot query shapes
// ---------------------------------------------------------------------------

const QUERY_SHAPES = [
  {
    id: 'Q1',
    label:
      'driver + completed + date cutoff + ORDER BY date DESC',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT
        trip_display_id,
        trip_date,
        distance,
        total_earnings,
        fuel_deducted
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND status = 'completed'
        AND trip_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY trip_date DESC;
    `,
  },

  {
    id: 'Q2',
    label:
      'driver + completed + COUNT(*)',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT COUNT(*)
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND status = 'completed';
    `,
  },

  {
    id: 'Q3',
    label:
      'driver + completed + ORDER BY date ASC',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT
        trip_display_id,
        trip_date,
        distance,
        total_earnings,
        fuel_deducted
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND status = 'completed'
      ORDER BY trip_date ASC;
    `,
  },

  {
    id: 'Q4',
    label:
      'driver_id filter only',
    sql: `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT
        trip_display_id,
        trip_date,
        distance,
        total_earnings,
        fuel_deducted
      FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}';
    `,
  },
];

// ---------------------------------------------------------------------------
// SQL helper
// ---------------------------------------------------------------------------

async function executeSql(query) {
  const { data, error } = await supabase.rpc('exec_sql', {
    query,
  });

  if (error) {
    throw new Error(
      `SQL error: ${error.message}\n\nQuery:\n${query}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// EXPLAIN result parsing
// ---------------------------------------------------------------------------

function normalizeExplainResult(result) {
  if (result == null) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (Array.isArray(result)) {
    return result
      .map((row) => {
        if (typeof row === 'string') {
          return row;
        }

        if (row && typeof row === 'object') {
          return Object.values(row)
            .map((value) => String(value))
            .join(' ');
        }

        return String(row);
      })
      .join('\n');
  }

  if (typeof result === 'object') {
    return Object.values(result)
      .map((value) => String(value))
      .join('\n');
  }

  return String(result);
}

function extractExecutionTime(planText) {
  const match = planText.match(
    /Execution Time:\s*([\d.]+)\s*ms/i
  );

  return match ? Number.parseFloat(match[1]) : null;
}

function extractPlanningTime(planText) {
  const match = planText.match(
    /Planning Time:\s*([\d.]+)\s*ms/i
  );

  return match ? Number.parseFloat(match[1]) : null;
}

function extractPlanNodes(planText) {
  return planText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      return (
        /Seq Scan/i.test(line) ||
        /Index Scan/i.test(line) ||
        /Index Only Scan/i.test(line) ||
        /Bitmap Heap Scan/i.test(line) ||
        /Bitmap Index Scan/i.test(line) ||
        /Sort/i.test(line)
      );
    });
}

function containsNode(nodes, pattern) {
  return nodes.some((node) => pattern.test(node));
}

function getPlanClassification(nodes) {
  if (containsNode(nodes, /Index Only Scan/i)) {
    return 'Index Only Scan';
  }

  if (containsNode(nodes, /Index Scan/i)) {
    return 'Index Scan';
  }

  if (containsNode(nodes, /Bitmap/i)) {
    return 'Bitmap Scan';
  }

  if (containsNode(nodes, /Seq Scan/i)) {
    return 'Sequential Scan';
  }

  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log('\nCleaning up synthetic benchmark rows...');

  try {
    await executeSql(`
      DELETE FROM trips
      WHERE driver_id = '${SYNTHETIC_DRIVER_ID}'
        AND trip_display_id LIKE '${BENCHMARK_PREFIX}%';
    `);

    console.log('✓ Synthetic rows removed.');
  } catch (error) {
    console.error(
      `✖ Cleanup failed: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function generateTripRows(count) {
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const daysAgo = Math.floor(Math.random() * 365);

    const tripDate = new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000
    ).toISOString();

    const displayId =
      `${BENCHMARK_PREFIX}${i
        .toString()
        .padStart(6, '0')}`;

    rows.push(
      `(
        '${SYNTHETIC_DRIVER_ID}',
        'completed',
        '${tripDate}',
        '${escapeSqlString(displayId)}'
      )`
    );
  }

  return rows;
}

async function seedTrips() {
  console.log(
    `\nSeeding ${tripCount} synthetic completed trips...`
  );

  const rows = generateTripRows(tripCount);

  const batchSize = 500;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(
      start,
      start + batchSize
    );

    await executeSql(`
      INSERT INTO trips (
        driver_id,
        status,
        trip_date,
        trip_display_id
      )
      VALUES
        ${batch.join(',\n')};
    `);

    const inserted = Math.min(
      start + batch.length,
      rows.length
    );

    console.log(
      `  Inserted ${inserted}/${rows.length}`
    );
  }

  console.log('✓ Synthetic trips seeded.');
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

async function runQueryBenchmark(shape) {
  const rawResult = await executeSql(shape.sql);

  const planText = normalizeExplainResult(rawResult);

  const executionMs =
    extractExecutionTime(planText);

  const planningMs =
    extractPlanningTime(planText);

  const nodes =
    extractPlanNodes(planText);

  return {
    id: shape.id,
    label: shape.label,
    executionMs,
    planningMs,
    nodes,
    planText,
  };
}

// ---------------------------------------------------------------------------
// Result output
// ---------------------------------------------------------------------------

function printResult(result) {
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${result.id} — ${result.label}`);
  console.log(`${'─'.repeat(78)}`);

  console.log(
    `Planning time  : ${
      result.planningMs != null
        ? `${result.planningMs} ms`
        : 'n/a'
    }`
  );

  console.log(
    `Execution time : ${
      result.executionMs != null
        ? `${result.executionMs} ms`
        : 'n/a'
    }`
  );

  console.log(
    `Plan           : ${getPlanClassification(result.nodes)}`
  );

  console.log('\nImportant plan nodes:');

  if (result.nodes.length === 0) {
    console.log('  (none detected)');
  } else {
    for (const node of result.nodes) {
      console.log(`  ${node}`);
    }
  }

  const hasSequentialScan =
    containsNode(result.nodes, /Seq Scan/i);

  const hasSort =
    containsNode(result.nodes, /^Sort\b/i);

  const hasIndexScan =
    containsNode(
      result.nodes,
      /Index Scan|Index Only Scan|Bitmap/i
    );

  if (hasSequentialScan) {
    console.log(
      '\n⚠ Sequential scan detected.'
    );
  }

  if (hasSort) {
    console.log(
      '⚠ Explicit Sort node detected.'
    );
  }

  if (hasIndexScan && !hasSequentialScan) {
    console.log(
      '✓ Index-based access detected.'
    );
  }
}

// ---------------------------------------------------------------------------
// Database statistics
// ---------------------------------------------------------------------------

async function analyzeTripsTable() {
  console.log('\nRefreshing trips table statistics...');

  try {
    await executeSql('ANALYZE trips;');
    console.log('✓ ANALYZE completed.');
  } catch (error) {
    console.warn(
      `⚠ Could not run ANALYZE: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Connection check
// ---------------------------------------------------------------------------

async function verifyExecSql() {
  console.log('\nChecking exec_sql RPC...');

  try {
    const result = await executeSql(
      'SELECT 1 AS benchmark_connection_test;'
    );

    console.log('✓ exec_sql RPC is available.');

    return result;
  } catch (error) {
    console.error(
      '\n✖ Could not execute raw SQL through exec_sql.'
    );

    console.error('\nThe benchmark requires a server-side SQL helper.');

    console.error(`
Example:

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  EXECUTE query INTO result;
  RETURN result;
END;
$$;
`);

    console.error(
      '\nIMPORTANT: exec_sql executes arbitrary SQL.'
    );

    console.error(
      'Do NOT expose this function to anonymous or normal client users.'
    );

    return null;
  }
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

function printExpectations() {
  console.log(`
=== Expected behaviour with composite index ===

Recommended index:

  CREATE INDEX idx_trips_driver_status_date
  ON trips (driver_id, status, trip_date DESC);

Q1:
  driver_id + status + trip_date range
  ORDER BY trip_date DESC

  Expected:
    Index Scan / Index Only Scan
    No explicit Sort in the ideal plan

Q2:
  driver_id + status
  COUNT(*)

  Expected:
    Index Scan or Index Only Scan
    No Sort

Q3:
  driver_id + status
  ORDER BY trip_date ASC

  Expected:
    The same DESC index can normally be scanned backwards.
    No explicit Sort should normally be required.

Q4:
  driver_id only

  Expected:
    The composite index CAN be used because driver_id
    is its leading column.

  However:
    PostgreSQL may legitimately choose another plan depending
    on table size, statistics, visibility, and estimated cost.

Therefore Q4 is NOT a guaranteed "Index Scan" test.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    '\n=== Trips Composite Index Benchmark ==='
  );

  console.log(
    `Synthetic trip rows: ${tripCount}`
  );

  console.log(
    `Synthetic driver   : ${SYNTHETIC_DRIVER_ID}`
  );

  printExpectations();

  const connection =
    await verifyExecSql();

  if (connection == null) {
    process.exitCode = 1;
    return;
  }

  let seeded = false;

  try {
    // Remove leftovers from a previous interrupted run first.
    await cleanup();

    await seedTrips();
    seeded = true;

    await analyzeTripsTable();

    console.log(
      '\n=== EXPLAIN ANALYZE RESULTS ==='
    );

    const results = [];

    for (const shape of QUERY_SHAPES) {
      try {
        const result =
          await runQueryBenchmark(shape);

        results.push(result);
        printResult(result);
      } catch (error) {
        console.error(
          `\n✖ ${shape.id} failed: ${error.message}`
        );
      }
    }

    console.log(
      `\n${'='.repeat(78)}`
    );

    console.log(
      'Benchmark complete.'
    );

    console.log(
      `${'='.repeat(78)}`
    );
  } finally {
    /*
     * Cleanup MUST happen even if:
     *   - seeding fails
     *   - EXPLAIN fails
     *   - one query throws
     *   - the benchmark is interrupted by an exception
     */
    if (seeded) {
      await cleanup();
    } else {
      // Also attempt cleanup because a partial batch may have been inserted.
      await cleanup();
    }
  }
}

main().catch(async (error) => {
  console.error(
    `\nBenchmark failed: ${error.message}`
  );

  /*
   * Best-effort cleanup for unexpected failures.
   */
  try {
    await cleanup();
  } catch {
    // Nothing else to do here.
  }

  process.exitCode = 1;
});
