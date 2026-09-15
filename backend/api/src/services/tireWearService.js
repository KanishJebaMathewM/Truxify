import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const TIRE_LIFESPAN_KM = 80000;
const LOAD_WEIGHT_FACTOR = 0.0002;
const ROAD_CONDITION_FACTORS = {
    good: 1.0,
    average: 1.2,
    poor: 1.5,
};
const WEATHER_FACTORS = {
    clear: 1.0,
    rain: 1.1,
    extreme_heat: 1.3,
    snow: 1.4,
};

const calculateTireWear = async (driverId) => {
    try {
        const { data: trips, error } = await supabase
            .from('trips')
            .select('distance_km, load_weight_kg, road_condition, weather')
            .eq('driver_id', driverId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (!trips || trips.length === 0) {
            return {
                wearPercentage: 0,
                remainingKm: TIRE_LIFESPAN_KM,
                needsReplacement: false,
                message: 'No trip data available for prediction.',
            };
        }

        let totalEffectiveWear = 0;

        for (const trip of trips) {
            const distance = trip.distance_km || 0;
            const loadWeight = trip.load_weight_kg || 0;
            const roadCondition = trip.road_condition || 'good';
            const weather = trip.weather || 'clear';

            const loadFactor = 1 + loadWeight * LOAD_WEIGHT_FACTOR;
            const roadFactor = ROAD_CONDITION_FACTORS[roadCondition] || 1.0;
            const weatherFactor = WEATHER_FACTORS[weather] || 1.0;

            const effectiveDistance = distance * loadFactor * roadFactor * weatherFactor;
            totalEffectiveWear += effectiveDistance;
        }

        const wearPercentage = Math.min((totalEffectiveWear / TIRE_LIFESPAN_KM) * 100, 100);
        const remainingKm = Math.max(TIRE_LIFESPAN_KM - totalEffectiveWear, 0);
        const needsReplacement = wearPercentage >= 80;

        return {
            wearPercentage: parseFloat(wearPercentage.toFixed(2)),
            remainingKm: parseFloat(remainingKm.toFixed(2)),
            needsReplacement,
            message: needsReplacement
                ? 'Warning: Tires need replacement soon.'
                : 'Tires are in acceptable condition.',
        };
    } catch (err) {
        console.error('Error calculating tire wear:', err.message);
        throw new Error('Failed to calculate tire wear analytics.');
    }
};

export { calculateTireWear };
