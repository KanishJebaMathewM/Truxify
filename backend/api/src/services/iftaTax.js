/**
 * Calculates straight-line distance (haversine formula) in miles between two GPS coordinates.
 */
function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth radius in miles
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
 * Evaluates GPS waypoints and fuel transactions to compile a quarterly IFTA report.
 * 
 * @param {Object} params - { truckId, quarter, year, waypoints, fuelPurchases }
 * @returns {Object} Jurisdiction mileage breakdown, fuel usage, and net taxable balance
 */
export function generateIftaReport(params) {
    const {
        truckId,
        quarter = 'Q3',
        year = 2026,
        waypoints = [],
        fuelPurchases = []
    } = params;

    const jurisdictionMetrics = {};

    // Calculate miles per jurisdiction from GPS waypoints
    for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        const state = curr.jurisdictionState || prev.jurisdictionState || 'UNKNOWN';

        const miles = calculateDistanceMiles(prev.latitude, prev.longitude, curr.latitude, curr.longitude);

        if (!jurisdictionMetrics[state]) {
            jurisdictionMetrics[state] = {
                jurisdictionState: state,
                totalMilesDriven: 0,
                taxableGallonsPurchased: 0,
                taxPaidUSD: 0
            };
        }

        jurisdictionMetrics[state].totalMilesDriven += miles;
    }

    // Aggregate fuel purchases per jurisdiction
    fuelPurchases.forEach((purchase) => {
        const state = purchase.jurisdictionState || 'UNKNOWN';
        if (!jurisdictionMetrics[state]) {
            jurisdictionMetrics[state] = {
                jurisdictionState: state,
                totalMilesDriven: 0,
                taxableGallonsPurchased: 0,
                taxPaidUSD: 0
            };
        }

        jurisdictionMetrics[state].taxableGallonsPurchased += purchase.gallons || 0;
        jurisdictionMetrics[state].taxPaidUSD += purchase.taxPaidUSD || 0;
    });

    // Format totals and calculate overall fleet MPG
    let grandTotalMiles = 0;
    let grandTotalGallons = 0;

    const breakdown = Object.values(jurisdictionMetrics).map((entry) => {
        const miles = parseFloat(entry.totalMilesDriven.toFixed(2));
        const gallons = parseFloat(entry.taxableGallonsPurchased.toFixed(2));
        const taxPaid = parseFloat(entry.taxPaidUSD.toFixed(2));

        grandTotalMiles += miles;
        grandTotalGallons += gallons;

        return {
            jurisdictionState: entry.jurisdictionState,
            totalMilesDriven: miles,
            taxableGallonsPurchased: gallons,
            taxPaidUSD: taxPaid
        };
    });

    const fleetAverageMpg = grandTotalGallons > 0 ? parseFloat((grandTotalMiles / grandTotalGallons).toFixed(2)) : 6.5;

    return {
        truckId,
        period: `${quarter} ${year}`,
        summary: {
            totalMilesDriven: parseFloat(grandTotalMiles.toFixed(2)),
            totalGallonsPurchased: parseFloat(grandTotalGallons.toFixed(2)),
            fleetAverageMpg
        },
        jurisdictionBreakdown: breakdown,
        generatedAt: new Date().toISOString()
    };
}
