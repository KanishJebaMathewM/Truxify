/**
 * Escrow Webhook Test Fixtures
 * 
 * Provides standardized payload structures for testing escrow webhook processing.
 */

export const createValidPaymentReleasedPayload = (overrides = {}) => ({
    orderId: 'TX-12345',
    amount: '500.00',
    currency: 'USD',
    txHash: '0xabcdef1234567890',
    timestamp: new Date().toISOString(),
    ...overrides,
});

export const createValidPaymentReleasedPayloadNoTxHash = (overrides = {}) => ({
    orderId: 'TX-12345',
    amount: '500.00',
    currency: 'USD',
    txHash: null,
    timestamp: new Date().toISOString(),
    ...overrides,
});

export const createInvalidPayloadMissingOrderId = (overrides = {}) => ({
    amount: '500.00',
    currency: 'USD',
    txHash: '0xabcdef1234567890',
    timestamp: new Date().toISOString(),
    ...overrides,
});

export const createMockOrder = (overrides = {}) => ({
    id: 'ord_98765',
    order_display_id: 'TX-12345',
    driver_id: 'drv_123',
    escrow_status: 'funded',
    release_tx_hash: null,
    refund_tx_hash: null,
    created_at: new Date().toISOString(),
    ...overrides,
});
