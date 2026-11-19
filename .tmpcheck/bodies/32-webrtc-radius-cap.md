## Problem

The nearby-peer route in `backend/api/src/routes/webrtcRoutes.js` accepts an arbitrary radius and forwards it to the peer lookup. A very large radius turns a local discovery request into a fleet-wide peer enumeration and can force the lookup to scan far more data than intended.

## Root cause

The radius is parsed for finiteness but has no upper bound. There is no configuration limit, so the caller controls the scope of the query.

## Impact

- An authenticated client can enumerate peers across a region or the whole fleet.
- Large-radius queries increase database or in-memory work and can degrade discovery for legitimate users.
- Location privacy expectations are violated because distant peers are exposed.

## Proposed fix

- Add a configured maximum radius, clamped to a safe positive value with a 100 km default.
- Reject requests above the limit with 400 and a clear maximum.
- Preserve the existing default and lower-bound behavior.

## Verification

- Request a radius above the default limit and assert 400.
- Set a valid environment override and assert the boundary is honored.
- Assert a normal local radius still returns peers.

Request: @Senthil455 please assign this issue.
