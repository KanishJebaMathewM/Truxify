const { createClient } = require('redis');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createSupabaseClient(supabaseUrl, supabaseKey);

const GEO_KEY = 'truxify:driver_locations';

redisClient.on('error', (err) => console.error('Redis Location Service Error', err));

const connectRedis = async () => {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
};

const ensureIndexes = async () => {
    try {
        await supabase.rpc('create_postgis_index_if_not_exists');
    } catch (err) {
        console.warn('Could not verify PostGIS indexes:', err.message);
    }
};

const updateDriverLocation = async (driverId, longitude, latitude) => {
    try {
        await connectRedis();

        await redisClient.geoAdd(GEO_KEY, {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            member: driverId,
        });

        const { error } = await supabase
            .from('driver_locations')
            .upsert({
                driver_id: driverId,
                longitude: parseFloat(longitude),
                latitude: parseFloat(latitude),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'driver_id' });

        if (error) console.error('Failed to update driver location in DB:', error.message);
        return true;
    } catch (err) {
        console.error('updateDriverLocation error:', err.message);
        try {
            await supabase.from('driver_locations').upsert({
                driver_id: driverId,
                longitude: parseFloat(longitude),
                latitude: parseFloat(latitude),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'driver_id' });
            return true;
        } catch (dbErr) {
            throw new Error('Failed to update location');
        }
    }
};

const findNearbyTrucks = async (longitude, latitude, radiusKm = 50, limit = 20) => {
    try {
        await connectRedis();

        const results = await redisClient.geoRadius(GEO_KEY, {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            radius: radiusKm,
            unit: 'km',
        }, {
            WITHDIST: true,
            COUNT: limit,
            SORT: 'ASC',
        });

        if (results && results.length > 0) {
            return results.map((res) => ({
                driverId: res.member,
                distanceKm: parseFloat(res.dist),
            }));
        }

        const { data, error } = await supabase.rpc('find_nearby_drivers', {
            lon: parseFloat(longitude),
            lat: parseFloat(latitude),
            radius_meters: radiusKm * 1000,
            max_results: limit,
        });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('findNearbyTrucks error:', err.message);
        const { data, error } = await supabase.rpc('find_nearby_drivers', {
            lon: parseFloat(longitude),
            lat: parseFloat(latitude),
            radius_meters: radiusKm * 1000,
            max_results: limit,
        });
        if (error) throw new Error('Failed to find nearby trucks');
        return data || [];
    }
};

module.exports = {
    updateDriverLocation,
    findNearbyTrucks,
    ensureIndexes,
};
