/**
 * Example: Syncing Internal Weights with DOT Enforcement
 * 
 * This example demonstrates how to call the syncAndTransmitInternalWeights function.
 * Note: Currently, this will always return an UNSUPPORTED response.
 */

import { syncAndTransmitInternalWeights } from '../../src/services/weighStationService.js';

async function syncWeightsExample() {
    const driverId = 'drv_987654321';
    const truckId = 'trk_123456789';

    // Mock axle weight data (in lbs)
    const axles = [
        { axleNumber: 1, weight: 12000, type: 'steer' },
        { axleNumber: 2, weight: 34000, type: 'drive' },
        { axleNumber: 3, weight: 34000, type: 'trailer' }
    ];

    console.log(`Syncing weights for truck ${truckId}...`);

    try {
        const result = await syncAndTransmitInternalWeights(driverId, truckId, axles);

        if (result.supported === false) {
            console.warn('Weight sync is currently unsupported.');
            console.warn('Reason:', result.reason);
            console.log('Action required:', result.action);

            // In a real app, you would log this for manual DOT compliance reporting.
            // logManualComplianceReport(driverId, truckId, axles);
        } else {
            console.log('Weights successfully transmitted to DOT enforcement.');
        }
    } catch (error) {
        console.error('Failed to sync internal weights:', error.message);
    }
}

// Execute the example
syncWeightsExample();
