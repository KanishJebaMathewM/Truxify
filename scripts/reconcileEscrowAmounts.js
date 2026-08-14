async function reconcileEscrowAmounts() {
  console.log('Running Escrow Amount Reconciliation Audit...');

  const { supabase } = await import('../backend/api/src/config/db.js');
  const { getEscrowBooking, getEscrowBookingId, paisaToMaticWei } = await import('../backend/api/src/services/escrow.js');

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_display_id, escrow_status, pending_bid_acceptance')
    .in('escrow_status', ['funded', 'released', 'payment_released']);

  if (error) {
    console.error(`Failed to query orders: ${error.message}`);
    process.exit(1);
  }

  let mismatches = 0;

  for (const order of orders) {
    try {
      const bidAmountPaisa = order.pending_bid_acceptance?.bid_amount;
      if (bidAmountPaisa == null) {
        console.warn(`[SKIPPED] Order: ${order.id} | No accepted bid amount recorded`);
        continue;
      }

      const expectedWei = BigInt(paisaToMaticWei(bidAmountPaisa));
      const booking = await getEscrowBooking(getEscrowBookingId(order.order_display_id));
      if (booking == null) {
        console.warn(`[SKIPPED] Order: ${order.id} | No on-chain booking found`);
        continue;
      }
      const onChainWei = BigInt(booking.amount.toString());

      if (onChainWei < expectedWei) {
        mismatches++;
        console.warn(`[MISMATCH DETECTED] Order: ${order.id} | Display ID: ${order.order_display_id}`);
        console.warn(`  Expected: ${expectedWei.toString()} Wei | On-Chain: ${onChainWei.toString()} Wei`);
      }
    } catch (err) {
      console.error(`Error checking order ${order.id}: ${err.message}`);
    }
  }

  console.log(`Scan finished. Total underfunded orders found: ${mismatches}`);
  process.exit(0);
}

reconcileEscrowAmounts();
