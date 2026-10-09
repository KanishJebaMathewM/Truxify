import crypto from 'crypto';

// In-memory marketplace store for active P2P trailer repositioning listings
const trailerListings = new Map();
const trailerBookings = new Map();

export const TRAILER_TYPES = ['DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'TANKER'];
export const DEFAULT_SECURITY_DEPOSIT_USD = 1500;

/**
 * Calculates match compatibility score between a repositioning trailer listing and a power-only driver route.
 */
export function calculateRouteMatchScore(listing, powerOnlyTrip) {
    if (!listing || !powerOnlyTrip) return 0;

    const originMatch = (listing.originCity || '').toLowerCase() === (powerOnlyTrip.originCity || '').toLowerCase();
    const destMatch = (listing.destinationCity || '').toLowerCase() === (powerOnlyTrip.destinationCity || '').toLowerCase();

    if (!originMatch || !destMatch) return 0;

    // Check equipment type compatibility (e.g. DRY_VAN, REEFER, FLATBED)
    if ((listing.trailerType || '').toUpperCase() !== (powerOnlyTrip.requiredTrailerType || '').toUpperCase()) {
        return 0;
    }

    return 95; // High confidence origin-destination match score
}

/**
 * Dynamic yield pricing calculation for trailer repositioning.
 * Idle trailers in surplus locations receive automated discounts to attract power-only drivers.
 * 
 * @param {number} baseRateUSD
 * @param {number} [daysIdle=0] Days sitting at lot
 * @param {string} [demandTier='BALANCED'] 'LOW_DEMAND', 'BALANCED', 'HIGH_DEMAND'
 * @returns {Object} Optimized daily rate and discount breakdown
 */
export function calculateRepositioningYieldPricing(baseRateUSD = 45, daysIdle = 0, demandTier = 'BALANCED') {
    if (!Number.isFinite(baseRateUSD) || baseRateUSD <= 0) {
        throw new RangeError('baseRateUSD must be a positive number');
    }

    let discountPercentage = 0;
    let surgePercentage = 0;

    // Idle days decay: 5% discount per 2 days idle, capped at 30%
    if (daysIdle >= 2) {
        discountPercentage = Math.min(30, Math.floor(daysIdle / 2) * 5);
    }

    if (demandTier === 'HIGH_DEMAND') {
        surgePercentage = 25;
    } else if (demandTier === 'LOW_DEMAND') {
        discountPercentage = Math.min(40, discountPercentage + 15);
    }

    const netFactor = 1 + (surgePercentage - discountPercentage) / 100;
    const optimizedDailyRateUSD = parseFloat((baseRateUSD * netFactor).toFixed(2));

    return {
        baseRateUSD,
        daysIdle,
        demandTier,
        discountPercentage,
        surgePercentage,
        optimizedDailyRateUSD,
        savingsUSDPerDay: parseFloat(Math.max(0, baseRateUSD - optimizedDailyRateUSD).toFixed(2))
    };
}

/**
 * Publishes an empty trailer repositioning listing from Carrier A.
 * 
 * @param {Object} listingParams - { carrierId, trailerId, trailerType, originCity, originState, destinationCity, destinationState, dailyRateUSD, maxAvailableDays }
 * @returns {Object} Created P2P listing record
 */
export function publishTrailerRepositioningListing(listingParams = {}) {
    const {
        carrierId,
        trailerId,
        trailerType = 'DRY_VAN',
        originCity,
        originState,
        destinationCity,
        destinationState,
        dailyRateUSD = 45, // Discounted repositioning rental rate
        maxAvailableDays = 3,
        daysIdle = 0,
        demandTier = 'BALANCED'
    } = listingParams;

    const listingId = `p2p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const pricing = calculateRepositioningYieldPricing(dailyRateUSD, daysIdle, demandTier);

    const listing = {
        listingId,
        ownerCarrierId: carrierId,
        trailerId,
        trailerType: (trailerType || 'DRY_VAN').toUpperCase(),
        originCity,
        originState,
        destinationCity,
        destinationState,
        dailyRateUSD,
        effectiveDailyRateUSD: pricing.optimizedDailyRateUSD,
        maxAvailableDays,
        daysIdle,
        demandTier,
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
export function findMatchingTrailersForTrip(powerOnlyTrip = {}) {
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

/**
 * Books a P2P trailer for power-only haul with escrow security deposit.
 * 
 * @param {string} listingId
 * @param {string} seekerCarrierId
 * @param {number} rentalDays
 * @param {Object} [options]
 * @returns {Object} Confirmed booking with escrow agreement
 */
export function bookTrailerWithEscrow(listingId, seekerCarrierId, rentalDays = 1, options = {}) {
    if (!listingId || !seekerCarrierId) {
        throw new TypeError('listingId and seekerCarrierId are required');
    }

    const listing = trailerListings.get(listingId);
    if (!listing) {
        throw new Error(`Listing ${listingId} not found`);
    }

    if (listing.status !== 'AVAILABLE') {
        throw new Error(`Trailer ${listing.trailerId} is no longer available (current status: ${listing.status})`);
    }

    if (listing.ownerCarrierId === seekerCarrierId) {
        throw new Error('Carrier cannot book their own trailer');
    }

    const days = Math.max(1, Math.min(listing.maxAvailableDays, Math.round(rentalDays)));
    const totalRentalFeeUSD = parseFloat((days * (listing.effectiveDailyRateUSD || listing.dailyRateUSD)).toFixed(2));
    const securityDepositUSD = options.securityDepositUSD || DEFAULT_SECURITY_DEPOSIT_USD;
    const totalEscrowHoldUSD = parseFloat((totalRentalFeeUSD + securityDepositUSD).toFixed(2));

    const bookingId = `book-p2p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const bookedAt = new Date().toISOString();

    const interchangeHash = crypto
        .createHash('sha256')
        .update(`${bookingId}:${listingId}:${seekerCarrierId}:${totalEscrowHoldUSD}:${bookedAt}`)
        .digest('hex');

    const booking = {
        bookingId,
        listingId,
        trailerId: listing.trailerId,
        trailerType: listing.trailerType,
        ownerCarrierId: listing.ownerCarrierId,
        seekerCarrierId,
        rentalDays: days,
        originCity: listing.originCity,
        destinationCity: listing.destinationCity,
        financials: {
            dailyRateUSD: listing.effectiveDailyRateUSD || listing.dailyRateUSD,
            totalRentalFeeUSD,
            securityDepositUSD,
            totalEscrowHoldUSD
        },
        escrowStatus: 'HELD_IN_ESCROW',
        bookingStatus: 'CONFIRMED',
        interchangeAgreementHash: interchangeHash,
        bookedAt
    };

    // Mark listing booked
    listing.status = 'BOOKED';
    trailerListings.set(listingId, listing);
    trailerBookings.set(bookingId, booking);

    return booking;
}

export function getActiveListings() {
    return Array.from(trailerListings.values());
}

export function clearListingsForTesting() {
    trailerListings.clear();
    trailerBookings.clear();
}

export default {
    publishTrailerRepositioningListing,
    findMatchingTrailersForTrip,
    calculateRepositioningYieldPricing,
    bookTrailerWithEscrow,
    calculateRouteMatchScore,
    getActiveListings,
    clearListingsForTesting,
    TRAILER_TYPES,
    DEFAULT_SECURITY_DEPOSIT_USD
};
