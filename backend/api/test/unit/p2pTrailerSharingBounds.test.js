import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    MAX_TRAILER_LISTINGS,
    TRAILER_LISTING_TTL_MS,
    publishTrailerRepositioningListing,
    clearListingsForTesting,
    getActiveListings,
} from '../../src/services/p2pTrailerSharing.js';
import p2pRouter from '../../src/routes/p2pTrailerSharing.js';

const listingParams = (i) => ({
    carrierId: `carrier-${i}`,
    trailerId: `trailer-${i}`,
    originCity: 'Dallas',
    destinationCity: 'Houston',
});

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/p2p-trailers', p2pRouter);
    return app;
}

describe('p2pTrailerSharing store bounds', () => {
    beforeEach(() => {
        clearListingsForTesting();
    });

    afterEach(() => {
        vi.useRealTimers();
        clearListingsForTesting();
    });

    it('expires listings older than the documented TTL before the next publish', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

        const oldListing = publishTrailerRepositioningListing(listingParams('old'));
        vi.advanceTimersByTime(TRAILER_LISTING_TTL_MS + 1);
        const newListing = publishTrailerRepositioningListing(listingParams('new'));

        const ids = getActiveListings().map((listing) => listing.listingId);
        expect(ids).not.toContain(oldListing.listingId);
        expect(ids).toContain(newListing.listingId);
    });

    it('rejects a new listing with a 429 capacity error once the hard cap is reached', () => {
        for (let i = 0; i < MAX_TRAILER_LISTINGS; i++) {
            publishTrailerRepositioningListing(listingParams(i));
        }

        let thrown;
        try {
            publishTrailerRepositioningListing(listingParams('overflow'));
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('P2P_STORE_CAPACITY');
        expect(thrown.statusCode).toBe(429);
        expect(thrown.message).toMatch(/capacity reached/);
        expect(getActiveListings()).toHaveLength(MAX_TRAILER_LISTINGS);
    });

    it('returns 429 instead of a generic 500 when the store is full', async () => {
        for (let i = 0; i < MAX_TRAILER_LISTINGS; i++) {
            publishTrailerRepositioningListing(listingParams(i));
        }

        const response = await request(makeApp())
            .post('/api/p2p-trailers/list-trailer')
            .send({
                carrierId: 'carrier-overflow',
                trailerId: 'trailer-overflow',
                originCity: 'Dallas',
                destinationCity: 'Houston',
            });

        expect(response.status).toBe(429);
        expect(response.body.error).toMatch(/capacity reached/);
    });
});
