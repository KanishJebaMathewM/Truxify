/**
 * Benchmark the composite indexes on `trips`.
 *
 * Runs EXPLAIN ANALYZE against the query shapes the driver earnings and
 * trip-history endpoints actually issue, and reports the plan nodes and
 * timings so the effect of idx_trips_driver_status_date can be measured
 * rather than asserted.
 *
 * Requires a direct PostgreSQL connection — PostgREST cannot return query
 * plans, so DATABASE_URL is used rather than the Supabase client.
 *
 * Usage:
 *   node scripts/benchmark-trips-index.js
 *   node scripts/benchmark-trips-index.js --driver-id <uuid>
 *
 * To measure the improvement, run it, then:
 *   DROP INDEX idx_trips_driver_status_date;
 * run it again, and re-create the index. Compare the plan nodes: with the
 * index the plan should show an Index Scan and no Sort node; without it,
 * a BitmapAnd plus an explicit Sort.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL. A direct PostgreSQL connection is required —');
  console.error('PostgREST cannot return query plans.');
  process.exit(1);
}

/** Query shapes taken from src/routes/driverRoutes.js. */
const QUERIES = [
  {
    name: 'period trips (driverRoutes.js:1477)',
    sql: `SELECT trip_display_id, route_label, trip_date, distance,
                 total_earnings, fuel_deducted, net_earnings, blockchain_hash
            FROM trips
           WHERE driver_id = $1 AND status = 'completed'
             AND trip_date >= $2
           ORDER BY trip_date DESC`,
    params: (driverId, cutoff) => [driverId, cutoff],
  },
  {
    name: 'lifetime count (driverRoutes.js:1489)',
    sql: `SELECT count(*) FROM trips
           WHERE driver_id = $1 AND status = 'completed'`,
    params: (driverId) => [driverId],
  },
  {
    name: 'deadhead adjacency (driverRoutes.js:1531)',
    sql: `SELECT route_label, trip_date
            FROM trips
           WHERE driver_id = $1 AND status = 'completed'
             AND trip_date >= $2
           ORDER BY trip_date ASC
           LIMIT 1000`,
    params: (driverId, cutoff) => [driverId, cutoff],
  },
  {
    name: 'ownership check (driverRoutes.js:629)',
    sql: `SELECT id FROM trips
           WHERE trip_display_id = $1 AND driver_id = $2`,
    params: (driverId) => ['TRP-000001', driverId],
  },
];

/** Plan node names that indicate the index is not being used effectively. */
const WARNING_NODES = ['Seq Scan', 'BitmapAnd', 'Sort ', 'external merge'];

function summarisePlan(planText) {
  const findings = [];
  for (const node of WARNING_NODES) {
    if (planText.includes(node)) {
      findings.push(node.trim());
    }
  }
  return findings;
}

function extractTiming(planText) {
  const match = planText.match(/Execution Time:\s*([\d.]+)\s*ms/);
  return match ? Number(match[1]) : null;
}

async function resolveDriverId(client, explicit) {
  if (explicit) return explicit;

  const { rows } = await client.query(
    `SELECT driver_id, count(*) AS trip_count
       FROM trips
      WHERE status = 'completed' AND driver_id IS NOT NULL
      GROUP BY driver_id
      ORDER BY trip_count DESC
      LIMIT 1`
  );

  if (rows.length === 0) {
    return null;
  }

  console.log(
    `Using the driver with the most completed trips: ${rows[0].driver_id} ` +
      `(${rows[0].trip_count} trips)\n`
  );
  return rows[0].driver_id;
}

async function listIndexes(client) {
  const { rows } = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'trips'
      ORDER BY indexname`
  );
  return rows;
}

async function main() {
  const argIndex = process.argv.indexOf('--driver-id');
  const explicitDriverId = argIndex !== -1 ? process.argv[argIndex + 1] : null;

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    console.log('--- trips index benchmark ---\n');

    const indexes = await listIndexes(client);
    console.log(`Indexes currently on trips (${indexes.length}):`);
    for (const idx of indexes) {
      console.log(`  ${idx.indexname}`);
    }

    const hasComposite = indexes.some(
      (idx) => idx.indexname === 'idx_trips_driver_status_date'
    );
    console.log(
      `\nComposite index present: ${hasComposite ? 'yes' : 'NO — run the migration first'}\n`
    );

    const driverId = await resolveDriverId(client, explicitDriverId);
    if (!driverId) {
      console.error('No completed trips found. Seed the trips table before benchmarking.');
      process.exitCode = 1;
      return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffKey = cutoff.toISOString().split('T')[0];

    for (const query of QUERIES) {
      const params = query.params(driverId, cutoffKey);
      const { rows } = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS) ${query.sql}`,
        params
      );
      const planText = rows.map((r) => r['QUERY PLAN']).join('\n');

      const timing = extractTiming(planText);
      const warnings = summarisePlan(planText);

      console.log(`── ${query.name}`);
      console.log(`   execution time: ${timing === null ? 'unknown' : `${timing} ms`}`);
      if (warnings.length > 0) {
        console.log(`   ⚠ plan contains: ${warnings.join(', ')}`);
      } else {
        console.log('   ✓ index scan, no sort node');
      }
      console.log(
        planText
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n')
      );
      console.log('');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
