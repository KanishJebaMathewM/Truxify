const osrmService = require('../services/osrmService');

const getRoute = async (req, res) => {
    try {
        const { startLon, startLat, endLon, endLat } = req.query;
        const rawCoordinates = [startLon, startLat, endLon, endLat];

        if (rawCoordinates.some(value => value === undefined || value === null || value === '')) {
            return res.status(400).json({
                error: 'Missing coordinates',
                message: 'startLon, startLat, endLon, and endLat are required'
            });
        }

        if (rawCoordinates.some(value => typeof value !== 'string')) {
            return res.status(400).json({
                error: 'Invalid coordinates',
                message: 'Coordinates must be provided as scalar values'
            });
        }

        const trimmedCoordinates = rawCoordinates.map(value => value.trim());

        if (trimmedCoordinates.some(value => value === '')) {
            return res.status(400).json({
                error: 'Missing coordinates',
                message: 'startLon, startLat, endLon, and endLat are required'
            });
        }

        const parsedCoordinates = trimmedCoordinates.map(Number);

        if (parsedCoordinates.some(value => !Number.isFinite(value))) {
            return res.status(400).json({
                error: 'Invalid coordinates',
                message: 'Coordinates must be finite numbers'
            });
        }

        const route = await osrmService.getRouteWithResilience(
            parsedCoordinates[0],
            parsedCoordinates[1],
            parsedCoordinates[2],
            parsedCoordinates[3]
        );

        return res.status(200).json({
            success: true,
            data: route,
        });
    } catch (error) {
        console.error('Routing controller error:', error.message);
        return res.status(500).json({
            error: 'Failed to calculate route',
            details: error.message
        });
    }
};

const getDistanceMatrix = async (req, res) => {
    try {
        const { coordinates } = req.body;

        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return res.status(400).json({
                error: 'Invalid coordinates',
                message: 'Request body must contain an array of at least 2 coordinate pairs [lon, lat]'
            });
        }

        const formattedCoords = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
        const url = `${process.env.OSRM_BASE_URL || 'http://localhost:5000'}/table/v1/driving/${formattedCoords}`;

        const response = await require('axios').get(url, { timeout: 5000 });

        if (response.data.code !== 'Ok') {
            throw new Error(`OSRM table returned error code: ${response.data.code}`);
        }

        return res.status(200).json({
            success: true,
            data: response.data.durations,
        });
    } catch (error) {
        console.error('Distance matrix controller error:', error.message);
        return res.status(500).json({
            error: 'Failed to calculate distance matrix',
            details: error.message
        });
    }
};

module.exports = {
    getRoute,
    getDistanceMatrix,
};
