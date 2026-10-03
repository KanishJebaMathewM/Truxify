/**
 * Example: Checking Weigh Station Bypass Eligibility
 * 
 * This example demonstrates how to call the checkBypassEligibility function.
 * Note: Currently, this will always return an UNSUPPORTED response.
 */

import { checkBypassEligibility } from '../../src/services/weighStationService.js';

async function checkBypassExample() {
    const driverId = 'drv_987654321';
    const stationLat = 34.0522;
    const stationLng = -118.2437;

    console.log(`Checking bypass eligibility for driver ${driverId} at [${stationLat}, ${stationLng}]...`);

    try {
        const result = await checkBypassEligibility(driverId, stationLat, stationLng);

        if (result.supported === false) {
            console.warn('Bypass is currently unsupported.');
            console.warn('Reason:', result.reason);
            console.log('Action required:', result.action);

            // In a real app, you would instruct the driver to pull in.
            // instructDriverToPullIn(driverId);
        } else {
            console.log('Bypass granted:', result.action);
        }
    } catch (error) {
        console.error('Failed to check bypass eligibility:', error.message);
    }
}

// Execute the example
checkBypassExample();