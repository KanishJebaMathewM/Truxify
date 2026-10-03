import { describe, it, expect } from 'vitest';
import {
  publishTrailerRepositioningListing,
  findMatchingTrailersForTrip,
} from '../../src/services/p2pTrailerSharing.js';

describe('p2pTrailerSharing', () => {
  describe('publishTrailerRepositioningListing', () => {
    it('creates a repositioning listing with default parameters', () => {
      const listing = publishTrailerRepositioningListing({
        carrierId: 'carrier-101',
        trailerId: 'trailer-v1',
        originCity: 'Dallas',
        originState: 'TX',
        destinationCity: 'Houston',
        destinationState: 'TX',
      });

      expect(listing).toBeDefined();
      expect(listing.listingId).toMatch(/^p2p-/);
      expect(listing.ownerCarrierId).toBe('carrier-101');
      expect(listing.trailerType).toBe('DRY_VAN');
      expect(listing.dailyRateUSD).toBe(45);
      expect(listing.maxAvailableDays).toBe(3);
      expect(listing.status).toBe('AVAILABLE');
      expect(typeof listing.createdAt).toBe('string');
    });

    it('creates a repositioning listing with custom parameters', () => {
      const listing = publishTrailerRepositioningListing({
        carrierId: 'carrier-202',
        trailerId: 'trailer-r2',
        trailerType: 'REEFER',
        originCity: 'Chicago',
        originState: 'IL',
        destinationCity: 'Atlanta',
        destinationState: 'GA',
        dailyRateUSD: 60,
        maxAvailableDays: 5,
      });

      expect(listing.ownerCarrierId).toBe('carrier-202');
      expect(listing.trailerType).toBe('REEFER');
      expect(listing.dailyRateUSD).toBe(60);
      expect(listing.maxAvailableDays).toBe(5);
    });
  });

  describe('findMatchingTrailersForTrip', () => {
    it('matches available trailers based on city route and equipment compatibility', () => {
      publishTrailerRepositioningListing({
        carrierId: 'c-match-1',
        trailerId: 'tr-match-1',
        trailerType: 'FLATBED',
        originCity: 'Phoenix',
        originState: 'AZ',
        destinationCity: 'Denver',
        destinationState: 'CO',
        dailyRateUSD: 50,
      });

      const matches = findMatchingTrailersForTrip({
        seekerCarrierId: 'seeker-99',
        originCity: 'phoenix',
        destinationCity: 'denver',
        requiredTrailerType: 'flatbed',
      });

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const matched = matches.find((m) => m.trailerId === 'tr-match-1');
      expect(matched).toBeDefined();
      expect(matched.matchScore).toBe(95);
      expect(matched.estimatedRepositioningSavingsUSD).toBe(180);
    });

    it('filters out listings with mismatched equipment types or routes', () => {
      publishTrailerRepositioningListing({
        carrierId: 'c-mismatch',
        trailerId: 'tr-mismatch-1',
        trailerType: 'DRY_VAN',
        originCity: 'Seattle',
        originState: 'WA',
        destinationCity: 'Portland',
        destinationState: 'OR',
      });

      const wrongTypeMatches = findMatchingTrailersForTrip({
        seekerCarrierId: 'seeker-1',
        originCity: 'Seattle',
        destinationCity: 'Portland',
        requiredTrailerType: 'REEFER',
      });
      expect(wrongTypeMatches.find((m) => m.trailerId === 'tr-mismatch-1')).toBeUndefined();

      const wrongRouteMatches = findMatchingTrailersForTrip({
        seekerCarrierId: 'seeker-2',
        originCity: 'Seattle',
        destinationCity: 'Miami',
        requiredTrailerType: 'DRY_VAN',
      });
      expect(wrongRouteMatches.find((m) => m.trailerId === 'tr-mismatch-1')).toBeUndefined();
    });

    it('ranks matches by lowest daily rate when match scores are equal', () => {
      publishTrailerRepositioningListing({
        carrierId: 'c-cheap',
        trailerId: 'tr-cheap',
        trailerType: 'DRY_VAN',
        originCity: 'Memphis',
        originState: 'TN',
        destinationCity: 'Nashville',
        destinationState: 'TN',
        dailyRateUSD: 30,
      });

      publishTrailerRepositioningListing({
        carrierId: 'c-expensive',
        trailerId: 'tr-expensive',
        trailerType: 'DRY_VAN',
        originCity: 'Memphis',
        originState: 'TN',
        destinationCity: 'Nashville',
        destinationState: 'TN',
        dailyRateUSD: 70,
      });

      const matches = findMatchingTrailersForTrip({
        seekerCarrierId: 'seeker-rank',
        originCity: 'Memphis',
        destinationCity: 'Nashville',
        requiredTrailerType: 'DRY_VAN',
      });

      const cheapIdx = matches.findIndex((m) => m.trailerId === 'tr-cheap');
      const expIdx = matches.findIndex((m) => m.trailerId === 'tr-expensive');

      expect(cheapIdx).toBeGreaterThanOrEqual(0);
      expect(expIdx).toBeGreaterThanOrEqual(0);
      expect(cheapIdx).toBeLessThan(expIdx);
    });
  });
});
