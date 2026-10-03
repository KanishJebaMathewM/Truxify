# Escrow Booking Lookup Service

## Overview
The `getEscrowBooking` function provides off-chain access to escrow booking records stored in the `escrow_bookings` table. This is used by the funding reconciliation sweeper to determine whether a deposit has landed on-chain before updating order state.

**Issue #7340 Resolution**: This function was previously missing from `escrow.js` exports, causing a `SyntaxError` on API server boot and breaking the entire funding reconciliation feature.

## Function Signature

```javascript
/**
 * Retrieves an escrow booking record by its ID.
 * @param {string} escrowBookingId - The UUID of the escrow booking
 * @returns {Promise<object|null>} The booking record or null if not found
 * @throws {Error} If database query fails
 */
async function getEscrowBooking(escrowBookingId)
```

## Implementation

The function queries the `escrow_bookings` table via the `supabaseAdmin` client:

```javascript
export async function getEscrowBooking(escrowBookingId) {
  if (!escrowBookingId || typeof escrowBookingId !== 'string') {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('escrow_bookings')
    .select('*')
    .eq('id', escrowBookingId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, escrowBookingId }, 'Failed to fetch escrow booking');
    throw error;
  }

  return data;
}
```

## Usage in Funding Reconciliation

The `escrowFundingReconciliation.js` sweeper uses this function to:

1. Find orders in `funding` state with an `escrow_booking_id`
2. Retrieve the booking record to get the on-chain transaction hash
3. Verify on-chain whether the deposit has been confirmed
4. Update the order's `escrow_status` accordingly

### Example Flow

```javascript
// In escrowFundingReconciliation.js
const orders = await findOrdersInFundingState();

for (const order of orders) {
  if (!order.escrow_booking_id) continue;
  
  const booking = await getEscrowBooking(order.escrow_booking_id);
  if (!booking) {
    logger.warn({ orderId: order.id }, 'Booking not found, skipping');
    continue;
  }
  
  const onChainStatus = await verifyOnChainDeposit(booking.tx_hash);
  if (onChainStatus.isConfirmed) {
    await updateOrderEscrowStatus(order.id, 'funded');
  }
}
```

## Booking Record Schema

The `escrow_bookings` table contains:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (escrow_booking_id) |
| `order_display_id` | TEXT | Display ID of the associated order |
| `amount_wei` | TEXT | Deposit amount in wei (string for precision) |
| `token_address` | TEXT | ERC20 token contract address |
| `payer_address` | TEXT | Customer's wallet address |
| `payee_address` | TEXT | Escrow contract address |
| `status` | TEXT | Booking status (pending, funded, refunded) |
| `tx_hash` | TEXT | On-chain transaction hash (null until confirmed) |
| `confirmed_at` | TIMESTAMPTZ | Timestamp of on-chain confirmation |
| `created_at` | TIMESTAMPTZ | Booking creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

## Error Handling

The function handles several edge cases:

1. **Null/undefined ID**: Returns `null` immediately without querying
2. **Empty string**: Returns `null` without querying
3. **Non-string ID**: Returns `null` without querying
4. **Database error**: Throws the error for caller to handle
5. **Not found**: Returns `null` (via `maybeSingle()`)

## Related Functions

- `getEscrowBookingId(orderDisplayId)` - Returns the booking ID for an order (already existed)
- `createEscrowBooking(orderId, amount)` - Creates a new booking record
- `updateBookingStatus(bookingId, status)` - Updates booking status

## Testing

Comprehensive tests verify:
- Function is exported correctly (resolves SyntaxError)
- Valid booking retrieval
- Missing booking handling
- Database error propagation
- Edge cases (null, undefined, empty strings)
- Concurrent access safety

Run tests:
```bash
npm run test -- backend/api/test/unit/services/escrowBooking.test.js
npm run test -- backend/api/test/integration/escrowFundingReconciliation.test.js
```

## Migration Notes

This fix is a pure additive change - no existing functionality is modified. The function was always intended to exist (referenced in code) but was never implemented.

## Future Improvements

1. **Caching**: Cache booking records in Redis to reduce DB load
2. **Batch lookup**: Add `getEscrowBookings(ids)` for bulk retrieval
3. **Event-driven updates**: Use Supabase Realtime to watch booking status changes
4. **Metrics**: Track booking lookup latency and miss rate
