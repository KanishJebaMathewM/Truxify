/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */

import { createHash } from 'crypto';

const hashValue = (input) => {
  const hex = createHash('sha256').update(input).digest('hex');
  return parseInt(hex.slice(0, 8), 16);
};

const checkBypassEligibility = async (driverId, lat, lng) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  // Deterministically decide bypass (80%) vs pull in (20%) from the driver and station,
  // so the same driver/station pair always produces the same reproducible outcome.
  const isBypass = hashValue(`${driverId}:${lat}:${lng}`) % 100 < 80;

  // Stable station ID derived from the station coordinates for logging
  const stationId = 'WS-' + (hashValue(`${lat}:${lng}`) % 1000);

  return {
    action: isBypass ? 'BYPASS' : 'PULL_IN',
    stationId,
    reason: isBypass ? 'Excellent safety score.' : 'Random inspection required.',
    timestamp: new Date().toISOString()
  };
};

export { checkBypassEligibility };
