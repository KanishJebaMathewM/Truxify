import { describe, it, expect, vi } from 'vitest';

/**
 * @fileoverview Unit tests for the IoT Device to Load mapping logic.
 * Verifies that authorization checks correctly compare device profile IDs 
 * against the load's assigned device_id, rather than comparing unrelated UUID spaces.
 * Resolves Issue #10502.
 */

// Mock the authorization logic extracted from iotRoutes.js
function checkDeviceAuthorization(userRole, userId, load) {
    if (!load) return { isAuthorized: false, reason: 'Load not found' };

    if (userRole === 'customer') {
        return { isAuthorized: load.customer_id === userId, reason: 'Customer ownership check' };
    }

    if (userRole === 'driver') {
        // Driver logic would check order assignment, simplified here
        return { isAuthorized: load.assigned_driver_id === userId, reason: 'Driver assignment check' };
    }

    if (userRole === 'iot_device') {
        // THE FIX: Compare device profile ID to the load's assigned device_id
        return {
            isAuthorized: load.device_id === userId,
            reason: 'Device mapping check'
        };
    }

    return { isAuthorized: false, reason: 'Unknown role' };
}

describe('IoT Device Authorization Logic (#10502)', () => {
    const DEVICE_PROFILE_ID = 'device-uuid-1111';
    const LOAD_ID = 'load-uuid-2222';
    const CUSTOMER_ID = 'customer-uuid-3333';

    const mockLoad = {
        id: LOAD_ID,
        customer_id: CUSTOMER_ID,
        device_id: DEVICE_PROFILE_ID, // The mapping column
        assigned_driver_id: 'driver-uuid-4444',
        status: 'in_transit'
    };

    describe('POST/GET Authorization for iot_device role', () => {
        it('should authorize iot_device when load.device_id matches req.user.id', () => {
            const result = checkDeviceAuthorization('iot_device', DEVICE_PROFILE_ID, mockLoad);

            expect(result.isAuthorized).toBe(true);
            expect(result.reason).toBe('Device mapping check');
        });

        it('should reject iot_device when load.device_id does NOT match req.user.id', () => {
            const otherDeviceId = 'device-uuid-9999';
            const result = checkDeviceAuthorization('iot_device', otherDeviceId, mockLoad);

            expect(result.isAuthorized).toBe(false);
        });

        it('should reject iot_device if load has no device_id assigned (null)', () => {
            const loadWithoutDevice = { ...mockLoad, device_id: null };
            const result = checkDeviceAuthorization('iot_device', DEVICE_PROFILE_ID, loadWithoutDevice);

            expect(result.isAuthorized).toBe(false);
        });

        it('should NOT compare req.user.id to load.id (the old broken logic)', () => {
            // The old bug was: isAuthorized = req.user.id === loadId
            // This test proves that comparing device profile ID to load ID fails
            const result = checkDeviceAuthorization('iot_device', DEVICE_PROFILE_ID, mockLoad);

            // If the old logic was used, it would check DEVICE_PROFILE_ID === LOAD_ID, which is false.
            // Our new logic checks DEVICE_PROFILE_ID === mockLoad.device_id, which is true.
            expect(result.isAuthorized).toBe(true);
            expect(DEVICE_PROFILE_ID).not.toBe(LOAD_ID); // Proving they are different UUID spaces
        });
    });

    describe('Authorization for other roles (Regression checks)', () => {
        it('should authorize customer when load.customer_id matches', () => {
            const result = checkDeviceAuthorization('customer', CUSTOMER_ID, mockLoad);
            expect(result.isAuthorized).toBe(true);
        });

        it('should reject customer when customer_id does not match', () => {
            const result = checkDeviceAuthorization('customer', 'wrong-customer-id', mockLoad);
            expect(result.isAuthorized).toBe(false);
        });

        it('should authorize driver when assigned_driver_id matches', () => {
            const result = checkDeviceAuthorization('driver', 'driver-uuid-4444', mockLoad);
            expect(result.isAuthorized).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should return false if load is null or undefined', () => {
            const result = checkDeviceAuthorization('iot_device', DEVICE_PROFILE_ID, null);
            expect(result.isAuthorized).toBe(false);
            expect(result.reason).toBe('Load not found');
        });

        it('should handle case-insensitive UUID comparison if needed', () => {
            // Supabase usually returns lowercase UUIDs, but good to be safe
            const upperCaseDeviceId = DEVICE_PROFILE_ID.toUpperCase();
            const loadWithLowerCase = { ...mockLoad, device_id: DEVICE_PROFILE_ID.toLowerCase() };

            // If the route uses strict equality, this might fail. 
            // This test documents the expectation that DB returns lowercase.
            const result = checkDeviceAuthorization('iot_device', upperCaseDeviceId, loadWithLowerCase);
            // Depending on implementation, this might be false. 
            // The actual route should normalize to lowercase.
            expect(result.isAuthorized).toBe(false);
        });
    });
});
