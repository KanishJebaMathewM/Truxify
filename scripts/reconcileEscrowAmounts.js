const { db } = require('../backend/api/src/db');
const { escrowContract } = require('../backend/api/src/services/escrow');
const { paisaToMaticWei } = require('../backend/api/src/utils/currency');

async function reconcileEscrowAmounts() {
  console.log('Running Escrow Amount Reconciliation Audit...');
  
  const orders = await db('orders')
    .select('id', 'display_id', 'accepted_bid_amount', 'escrow_status')
    .whereIn('escrow_status', ['funded', 'released', 'payment_released']);

  let mismatches = 0;

  for (const order of orders) {
    try {
      const expectedWei = BigInt(paisaToMaticWei(order.accepted_bid_amount));
      const booking = await escrowContract.bookings(order.display_id);
      const onChainWei = BigInt(booking.amount.toString());

      if (onChainWei < expectedWei) {
        mismatches++;
        console.warn(`[MISMATCH DETECTED] Order: ${order.id} | Display ID: ${order.display_id}`);
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
