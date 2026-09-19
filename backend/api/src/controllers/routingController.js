import osrmService from '../services/osrmService.js';

/**
 * Calculates a point-to-point driving route with exponential backoff and Haversine straight-line resilience.
 * @route GET /api/routing/route
 */
export const getRoute = async (req, res) => {
    try {
        const { startLon, startLat, endLon, endLat, units } = req.query;
        const rawCoordinates = [startLon, startLat, endLon, endLat];

        if (rawCoordinates.some(value => value === undefined || value === null || value === '')) {
            return res.status(400).json({
                success: false,
                error: 'Missing coordinates',
                message: 'startLon, startLat, endLon, and endLat query parameters are required'
            });
        }

        if (rawCoordinates.some(value => typeof value !== 'string')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates',
                message: 'Coordinates must be provided as scalar query strings'
            });
        }

        const trimmedCoordinates = rawCoordinates.map(value => value.trim());
        if (trimmedCoordinates.some(value => value === '')) {
            return res.status(400).json({
                success: false,
                error: 'Missing coordinates',
                message: 'startLon, startLat, endLon, and endLat cannot be empty strings'
            });
        }

        const parsedCoordinates = trimmedCoordinates.map(Number);
        if (parsedCoordinates.some(value => !Number.isFinite(value))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates',
                message: 'Coordinates must be finite numerical values'
            });
        }

        const [sLon, sLat, eLon, eLat] = parsedCoordinates;

        // Spherical boundary limits
        if (sLat < -90 || sLat > 90 || eLat < -90 || eLat > 90) {
            return res.status(400).json({
                success: false,
                error: 'Out of range latitude',
                message: 'Latitude values must be between -90 and 90 degrees'
            });
        }
        if (sLon < -180 || sLon > 180 || eLon < -180 || eLon > 180) {
            return res.status(400).json({
                success: false,
                error: 'Out of range longitude',
                message: 'Longitude values must be between -180 and 180 degrees'
            });
        }

        const route = await osrmService.getRouteWithResilience(sLon, sLat, eLon, eLat);

        let distance = route.distance;
        let duration = route.duration;
        let distanceUnit = 'meters';
        let durationUnit = 'seconds';

        if (units === 'km' || units === 'metric') {
            distance = parseFloat((distance / 1000).toFixed(2));
            duration = parseFloat((duration / 60).toFixed(1));
            distanceUnit = 'kilometers';
            durationUnit = 'minutes';
        }

        return res.status(200).json({
            success: true,
            fallback: Boolean(route.fallback),
            data: {
                ...route,
                distance,
                duration,
                units: {
                    distance: distanceUnit,
                    duration: durationUnit
                }
            }
        });
    } catch (error) {
        console.error('Routing controller route calculation error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to calculate route',
            details: error.message
        });
    }
};

/**
 * Computes an N x N or N x M distance and duration matrix for multi-stop freight route optimization.
 * Automatically fails over to freight-calibrated Haversine tortuosity matrix if OSRM is unavailable.
 * @route POST /api/routing/matrix
 */
export const getDistanceMatrix = async (req, res) => {
    try {
        const { coordinates, tortuosityFactor, averageSpeedKmh, maxPoints, units } = req.body || {};

        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates',
                message: 'Request body must contain an array of at least 2 coordinate pairs [[lon, lat], ...]'
            });
        }

        const pointLimit = Number.isInteger(maxPoints) && maxPoints > 0 ? maxPoints : 50;
        if (coordinates.length > pointLimit) {
            return res.status(400).json({
                success: false,
                error: 'Matrix size limit exceeded',
                message: `Cannot request distance matrix with more than ${pointLimit} waypoints. Received ${coordinates.length}.`
            });
        }

        // Validate each coordinate pair shape
        for (let i = 0; i < coordinates.length; i++) {
            const pair = coordinates[i];
            if (!Array.isArray(pair) || pair.length < 2) {
                return res.status(400).json({
                    success: false,
                    error: 'Malformed coordinate waypoint',
                    message: `Waypoint at index ${i} must be an array of [longitude, latitude]`
                });
            }
            const lon = Number(pair[0]);
            const lat = Number(pair[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
                return res.status(400).json({
                    success: false,
                    error: 'Non-finite coordinate value',
                    message: `Waypoint at index ${i} must contain valid finite numbers for longitude and latitude`
                });
            }
            if (lat < -90 || lat > 90) {
                return res.status(400).json({
                    success: false,
                    error: 'Latitude out of bounds',
                    message: `Waypoint at index ${i} latitude (${lat}) must be between -90 and 90 degrees`
                });
            }
            if (lon < -180 || lon > 180) {
                return res.status(400).json({
                    success: false,
                    error: 'Longitude out of bounds',
                    message: `Waypoint at index ${i} longitude (${lon}) must be between -180 and 180 degrees`
                });
            }
        }

        const options = {
            maxPoints: pointLimit,
            tortuosityFactor: typeof tortuosityFactor === 'number' ? tortuosityFactor : undefined,
            averageSpeedKmh: typeof averageSpeedKmh === 'number' ? averageSpeedKmh : undefined
        };

        const result = await osrmService.getDistanceMatrixWithResilience(coordinates, options);

        let durations = result.durations;
        let distances = result.distances;
        let distanceUnit = 'meters';
        let durationUnit = 'seconds';

        if (units === 'km' || units === 'metric') {
            if (distances) {
                distances = distances.map(row => row.map(d => parseFloat((d / 1000).toFixed(2))));
            }
            if (durations) {
                durations = durations.map(row => row.map(t => parseFloat((t / 60).toFixed(1))));
            }
            distanceUnit = 'kilometers';
            durationUnit = 'minutes';
        }

        return res.status(200).json({
            success: true,
            fallback: Boolean(result.fallback),
            matrixSize: coordinates.length,
            units: {
                distance: distanceUnit,
                duration: durationUnit
            },
            data: {
                durations,
                distances,
                sources: result.sources,
                destinations: result.destinations,
                circuitBreakerState: result.circuitBreakerState,
                message: result.message || 'Distance matrix computed successfully',
                error: result.error || null
            }
        });
    } catch (error) {
        console.error('Distance matrix controller execution error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to calculate distance matrix',
            details: error.message
        });
    }
};

export default {
    getRoute,
    getDistanceMatrix,
};
