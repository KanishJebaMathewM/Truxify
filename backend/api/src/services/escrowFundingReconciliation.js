// Example modification for successful reconciliation handlers (around lines 161-166 and 233-248)

// --- On Success ---
await this.orderRepository.updateOrderWithFilter(order.id, {
  escrow_funding_status: 'SUCCESS',
  escrow_funding_attempts: 0,
  escrow_funding_last_attempt_at: new Date().toISOString(), // Track last execution time on success too
  escrow_funding_error: null,
  updated_at: new Date().toISOString(),
}, {
  // Optional conditional filters to prevent race conditions
  escrow_funding_status: 'PENDING'
});
