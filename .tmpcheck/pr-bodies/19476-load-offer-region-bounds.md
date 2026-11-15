## Problem

`LoadOfferCacheService.getRegion()` in `backend/api/src/services/order/loadOfferCacheService.js` checks only that latitude and longitude are finite. `ngeohash.encode()` accepts values outside the geographic range, so a bad GPS sample such as latitude 999 is mapped to a geohash bucket that no real location or invalidation ever uses.

## Change

- Require latitude within -90 to 90 and longitude within -180 to 180.
- Fall back to the existing `global` region for out-of-range values.
- Keep the current behavior for missing and non-finite coordinates.

## Verification

- Test latitudes 90, -90, 91, -91 and longitudes 180, -180, 181, -181.
- Assert valid coordinates still produce a stable geohash.
- Run the load offer cache tests.

Closes #19476
