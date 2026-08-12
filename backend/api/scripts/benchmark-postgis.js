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
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runBenchmark() {
  console.log('--- PostGIS GIST Index Benchmark ---');
  
  // Define search parameters
  const targetLat = 19.0760;
  const targetLng = 72.8777;
  const radiusMeters = 50000; // 50km
  
  // Note: To properly run this benchmark locally, you would:
  // 1. Seed the driver_locations table with 10,000 mock rows scattered around India
  // 2. Drop the GIST index and measure the execution time
  // 3. Re-create the GIST index and measure the execution time
  
  console.log(`\nQuerying for trucks within ${radiusMeters/1000}km of (${targetLat}, ${targetLng})...`);
  
  const start = performance.now();
  
  // Using PostGIS ST_DWithin via Supabase RPC (since direct PostGIS filters aren't natively supported 
  // via PostgREST without an RPC function in standard Supabase setup)
  const { data, error } = await supabase.rpc('get_nearby_drivers', {
    search_lat: targetLat,
    search_lng: targetLng,
    radius_meters: radiusMeters
  });
  
  const end = performance.now();
  
  if (error) {
    if (error.code === 'PGRST202') {
      console.log('RPC get_nearby_drivers not found. Ensure you have created it.');
      console.log('\nExample RPC creation:');
      console.log(`
CREATE OR REPLACE FUNCTION get_nearby_drivers(search_lat float, search_lng float, radius_meters float)
RETURNS SETOF driver_locations AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM driver_locations
  WHERE ST_DWithin(
    location,
    ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
    radius_meters
  );
END;
$$ LANGUAGE plpgsql;`);
    } else {
      console.error('Error querying nearby drivers:', error);
    }
    process.exit(1);
  }
  
  const executionTimeMs = (end - start).toFixed(2);
  console.log(`Query completed in ${executionTimeMs} ms. Found ${data?.length || 0} drivers.`);
  console.log('\nExpectations:');
  console.log('- Without GIST Index (10k rows): ~15-25ms (Sequential Scan)');
  console.log('- With GIST Index (10k rows): ~1-3ms (Index Scan)');
}

runBenchmark().catch(console.error);
