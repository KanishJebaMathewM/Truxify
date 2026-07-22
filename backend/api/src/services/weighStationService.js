/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */

const checkBypassEligibility = async (driverId, lat, lng) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  // Determine bypass (80% chance) vs pull in (20% chance)
  const isBypass = Math.random() > 0.2;
  
  // Randomly assign an ID for the station for logging
  const stationId = 'WS-' + Math.floor(Math.random() * 1000);

  return {
    action: isBypass ? 'BYPASS' : 'PULL_IN',
    stationId,
    reason: isBypass ? 'Excellent safety score.' : 'Random inspection required.',
    timestamp: new Date().toISOString()
  };
};

module.exports = {
  checkBypassEligibility
};
