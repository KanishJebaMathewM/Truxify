// In-memory marketplace store for active P2P trailer repositioning listings
const trailerListings = new Map();

/**
 * Calculates match compatibility score between a repositioning trailer listing and a power-only driver route.
 */
function calculateRouteMatchScore(listing, powerOnlyTrip) {
    const originMatch = listing.originCity.toLowerCase() === powerOnlyTrip.originCity.toLowerCase();
    const destMatch = listing.destinationCity.toLowerCase() === powerOnlyTrip.destinationCity.toLowerCase();

    if (!originMatch || !destMatch) return 0;

    // Check equipment type compatibility (e.g. DRY_VAN, REEFER, FLATBED)
    if (listing.trailerType.toUpperCase() !== powerOnlyTrip.requiredTrailerType.toUpperCase()) {
        return 0;
    }

    return 95; // High confidence origin-destination match score
}

/**
 * Publishes an empty trailer repositioning listing from Carrier A.
 * 
 * @param {Object} listingParams - { carrierId, trailerId, trailerType, originCity, originState, destinationCity, destinationState, dailyRateUSD, maxAvailableDays }
 * @returns {Object} Created P2P listing record
 */
export function publishTrailerRepositioningListing(listingParams) {
    const {
        carrierId,
        trailerId,
        trailerType = 'DRY_VAN',
        originCity,
        originState,
        destinationCity,
        destinationState,
        dailyRateUSD = 45, // Discounted repositioning rental rate
        maxAvailableDays = 3
    } = listingParams;

    const listingId = `p2p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const listing = {
        listingId,
        ownerCarrierId: carrierId,
        trailerId,
        trailerType,
        originCity,
        originState,
        destinationCity,
        destinationState,
        dailyRateUSD,
        maxAvailableDays,
        status: 'AVAILABLE',
        createdAt: new Date().toISOString()
    };

    trailerListings.set(listingId, listing);
    return listing;
}

/**
 * Searches and matches active P2P trailer listings for Carrier B running power-only trips.
 * 
 * @param {Object} powerOnlyTrip - { seekerCarrierId, originCity, destinationCity, requiredTrailerType }
 * @returns {Array} Ranked list of matching P2P trailer rentals
 */
export function findMatchingTrailersForTrip(powerOnlyTrip) {
    const matches = [];

    for (const listing of trailerListings.values()) {
        if (listing.status !== 'AVAILABLE') continue;

        const matchScore = calculateRouteMatchScore(listing, powerOnlyTrip);

        if (matchScore > 0) {
            matches.push({
                ...listing,
                matchScore,
                estimatedRepositioningSavingsUSD: 180 // Estimated fuel/deadhead cost saved
            });
        }
    }

    // Sort matches by highest score and lowest daily rate
    return matches.sort((a, b) => b.matchScore - a.matchScore || a.dailyRateUSD - b.dailyRateUSD);
}
