// In-memory store for active yard trailer pins (or mapped to DB layer)
const trailerYardPins = new Map();

/**
 * Calculates straight-line distance (haversine) in meters between two GPS coordinates.
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Records a high-precision GPS drop pin when a driver unhooks a trailer in a distribution yard.
 * 
 * @param {Object} dropData - { trailerId, driverId, facilityId, latitude, longitude, yardSlotId, zone }
 * @returns {Object} Confirmed drop location record
 */
export function recordTrailerDrop(dropData) {
    const {
        trailerId,
        driverId,
        facilityId,
        latitude,
        longitude,
        yardSlotId = 'UNASSIGNED_SLOT',
        zone = 'GENERAL_YARD'
    } = dropData;

    const pinRecord = {
        trailerId,
        droppedByDriverId: driverId,
        facilityId,
        coordinates: {
            latitude,
            longitude,
            precisionMeters: 1.5 // High-precision GPS accuracy
        },
        yardSlotId,
        zone,
        droppedAt: new Date().toISOString()
    };

    trailerYardPins.set(trailerId, pinRecord);
    return pinRecord;
}

/**
 * Retrieves the exact location pin of a dropped trailer and provides AR/micro-location waypoints.
 * 
 * @param {String} trailerId - Unique trailer ID
 * @param {Object} driverLocation - { latitude, longitude }
 * @returns {Object} Micro-location guidance details
 */
export function locateTrailerInYard(trailerId, driverLocation = {}) {
    const pin = trailerYardPins.get(trailerId);

    if (!pin) {
        return {
            found: false,
            message: `No active micro-location pin found for trailer ${trailerId}`
        };
    }

    let distanceMeters = null;
    let arNavigationSteps = [];

    if (driverLocation.latitude && driverLocation.longitude) {
        distanceMeters = calculateDistanceMeters(
            driverLocation.latitude,
            driverLocation.longitude,
            pin.coordinates.latitude,
            pin.coordinates.longitude
        );

        arNavigationSteps = [
            `Proceed to Yard Zone: ${pin.zone}`,
            `Navigate towards Aisle/Slot: ${pin.yardSlotId}`,
            `Trailer pin distance: ${distanceMeters} meters away`,
            `Follow AR visual indicator to high-precision GPS pin (${pin.coordinates.latitude}, ${pin.coordinates.longitude})`
        ];
    }

    return {
        found: true,
        trailerPin: pin,
        driverProximityMeters: distanceMeters,
        arGuidance: {
            targetSlot: pin.yardSlotId,
            zone: pin.zone,
            navigationSteps: arNavigationSteps
        }
    };
}
