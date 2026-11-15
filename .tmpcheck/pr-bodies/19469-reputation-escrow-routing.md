## Problem

`BatchCallBuilder.buildReputationCall()` in `backend/api/src/services/blockchain/batchCallBuilder.js` falls back to the escrow contract address when `REPUTATION_CONTRACT_ADDRESS` is unset. The reputation function selector is then sent to escrow, which does not implement it, so the entire multicall reverts and payment or balance reads in the same batch fail with it.

## Change

- Throw a clear configuration error when a reputation call is requested without a reputation address.
- In the optional shipment batch path, include reputation only when the address is configured.
- Keep the escrow target exclusively for escrow functions.

## Verification

- Construct a builder without `REPUTATION_CONTRACT_ADDRESS` and assert `buildReputationCall()` throws.
- Assert a configured reputation address is used for the reputation call.
- Assert the shipment batch omits reputation when it is unconfigured and still includes escrow calls.

Closes #19469
