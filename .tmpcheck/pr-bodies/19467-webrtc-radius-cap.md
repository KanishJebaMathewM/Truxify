## Problem

The nearby-peer route in `backend/api/src/routes/webrtcRoutes.js` accepts an arbitrary radius and forwards it to the peer lookup. A very large radius turns a local discovery request into a fleet-wide peer enumeration and can force the lookup to scan far more data than intended.

## Change

- Add a configured maximum radius, clamped to a safe positive value with a 100 km default.
- Reject requests above the limit with 400 and a clear maximum.
- Preserve the existing default and lower-bound behavior.

## Verification

- Request a radius above the default limit and assert 400.
- Set a valid environment override and assert the boundary is honored.
- Assert a normal local radius still returns peers.

Closes #19467
