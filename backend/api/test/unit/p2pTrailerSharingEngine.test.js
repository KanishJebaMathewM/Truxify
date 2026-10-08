import assert from 'node:assert';
import {
    publishTrailerRepositioningListing,
    findMatchingTrailersForTrip,
    calculateRepositioningYieldPricing,
    bookTrailerWithEscrow,
    clearListingsForTesting,
    DEFAULT_SECURITY_DEPOSIT_USD
} from '../../src/services/p2pTrailerSharing.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running P2P Trailer Sharing & Yield Optimization Tests ---');

// Clear marketplace store before starting tests
clearListingsForTesting();

await test('calculates dynamic yield pricing discounts for idle trailers', () => {
    // 0 days idle in balanced market -> 0% discount ($50)
    const fresh = calculateRepositioningYieldPricing(50, 0, 'BALANCED');
    assert.strictEqual(fresh.optimizedDailyRateUSD, 50.00);
    assert.strictEqual(fresh.discountPercentage, 0);

    // 6 days idle -> 3 * 5% = 15% discount ($42.50)
    const idle = calculateRepositioningYieldPricing(50, 6, 'BALANCED');
    assert.strictEqual(idle.discountPercentage, 15);
    assert.strictEqual(idle.optimizedDailyRateUSD, 42.50);
    assert.strictEqual(idle.savingsUSDPerDay, 7.50);

    // High demand surge (+25% premium on $60 = $75.00)
    const surge = calculateRepositioningYieldPricing(60, 0, 'HIGH_DEMAND');
    assert.strictEqual(surge.surgePercentage, 25);
    assert.strictEqual(surge.optimizedDailyRateUSD, 75.00);
});

await test('publishes trailer listing with automated yield pricing evaluation', () => {
    const listing = publishTrailerRepositioningListing({
        carrierId: 'CARRIER-ALPHA',
        trailerId: 'TR-DRY-88',
        trailerType: 'DRY_VAN',
        originCity: 'Dallas',
        originState: 'TX',
        destinationCity: 'Houston',
        destinationState: 'TX',
        dailyRateUSD: 50,
        daysIdle: 4 // 10% discount
    });

    assert.ok(listing.listingId.startsWith('p2p-'));
    assert.strictEqual(listing.status, 'AVAILABLE');
    assert.strictEqual(listing.trailerType, 'DRY_VAN');
    assert.strictEqual(listing.effectiveDailyRateUSD, 45.00); // $50 - 10% = $45
});

await test('matches available trailers and ranks by score and price', () => {
    publishTrailerRepositioningListing({
        carrierId: 'CARRIER-BETA',
        trailerId: 'TR-CHEAP',
        trailerType: 'REEFER',
        originCity: 'Atlanta',
        destinationCity: 'Miami',
        dailyRateUSD: 60
    });

    publishTrailerRepositioningListing({
        carrierId: 'CARRIER-GAMMA',
        trailerId: 'TR-EXPENSIVE',
        trailerType: 'REEFER',
        originCity: 'Atlanta',
        destinationCity: 'Miami',
        dailyRateUSD: 90
    });

    const matches = findMatchingTrailersForTrip({
        originCity: 'atlanta',
        destinationCity: 'miami',
        requiredTrailerType: 'reefer'
    });

    assert.ok(matches.length >= 2);
    // Cheapest should rank first
    assert.strictEqual(matches[0].trailerId, 'TR-CHEAP');
    assert.strictEqual(matches[0].matchScore, 95);
});

await test('books trailer with security deposit escrow and marks listing unavailable', () => {
    const listing = publishTrailerRepositioningListing({
        carrierId: 'CARRIER-OWNER-1',
        trailerId: 'TR-ESCROW-01',
        originCity: 'Chicago',
        destinationCity: 'Detroit',
        dailyRateUSD: 40,
        maxAvailableDays: 3
    });

    const booking = bookTrailerWithEscrow(listing.listingId, 'CARRIER-RENTER-2', 2);

    assert.strictEqual(booking.bookingStatus, 'CONFIRMED');
    assert.strictEqual(booking.escrowStatus, 'HELD_IN_ESCROW');
    assert.strictEqual(booking.rentalDays, 2);
    assert.strictEqual(booking.financials.totalRentalFeeUSD, 80.00); // 2 * $40
    assert.strictEqual(booking.financials.securityDepositUSD, DEFAULT_SECURITY_DEPOSIT_USD);
    assert.strictEqual(booking.financials.totalEscrowHoldUSD, 1580.00); // $80 + $1500
    assert.ok(booking.interchangeAgreementHash.length === 64);

    // Listing status must now be BOOKED
    assert.strictEqual(listing.status, 'BOOKED');
});

await test('prevents double-booking of an already booked trailer', () => {
    const listing = publishTrailerRepositioningListing({
        carrierId: 'CARRIER-OWNER-2',
        trailerId: 'TR-DOUBLE-BOOK',
        originCity: 'Seattle',
        destinationCity: 'Portland',
        dailyRateUSD: 45
    });

    // First booking succeeds
    bookTrailerWithEscrow(listing.listingId, 'RENTER-A', 1);

    // Second booking attempt must throw an error
    assert.throws(
        () => bookTrailerWithEscrow(listing.listingId, 'RENTER-B', 1),
        /is no longer available/
    );
});

await test('rejects carrier trying to book their own trailer', () => {
    const listing = publishTrailerRepositioningListing({
        carrierId: 'CARRIER-SELF',
        trailerId: 'TR-SELF',
        originCity: 'Denver',
        destinationCity: 'Salt Lake City'
    });

    assert.throws(
        () => bookTrailerWithEscrow(listing.listingId, 'CARRIER-SELF', 1),
        /cannot book their own trailer/
    );
});

console.log('\n🎉 All P2P Trailer Sharing & Yield Optimization tests passed successfully!\n');
