/**
 * Match complete_trip_tx's wallet credit: negotiated bid, then total amount.
 * Keep stored amount units. Only legacy rows missing both payout fields need
 * reconstruction from the full customer price (base + toll + platform fee).
 */
export function getStatementPayout(order) {
  const legacyTotal = (Number(order.base_freight) || 0)
    + (Number(order.toll_estimate) || 0)
    + (Number(order.platform_fee) || 0);
  const amount = Number(order.bid_amount ?? order.total_amount ?? legacyTotal);
  return Number.isFinite(amount) ? amount : 0;
}
