/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */

const SIMULATED_NETWORK_DELAY_MS = 800;
const PULL_IN_PROBABILITY = 0.2;
const STATION_ID_RANGE = 1000;

const checkBypassEligibility = async (driverId, lat, lng) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, SIMULATED_NETWORK_DELAY_MS));

  // Determine bypass (80% chance) vs pull in (20% chance)
  const isBypass = Math.random() > PULL_IN_PROBABILITY;
  
  // Randomly assign an ID for the station for logging
  const stationId = 'WS-' + Math.floor(Math.random() * STATION_ID_RANGE);

  return {
    action: isBypass ? 'BYPASS' : 'PULL_IN',
    stationId,
    reason: isBypass ? 'Excellent safety score.' : 'Random inspection required.',
    timestamp: new Date().toISOString()
  };
};

export { checkBypassEligibility };
