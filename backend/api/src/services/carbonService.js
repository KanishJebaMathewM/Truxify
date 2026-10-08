import logger from '../middleware/logger.js';

// Emission factors in grams of CO2e per ton-km based on GLEC / ISO 14083 standards
const EMISSION_FACTORS = {
  'BS-IV': 62.5,
  'BS-VI': 50.0,
  'CNG': 42.0,
  'EV': 10.5, // Well-to-wheel grid average
};

export class CarbonService {
  /**
   * Calculates CO2e emissions for a freight trip.
   * @param {Object} params
   * @param {string} params.fuelClass - 'BS-IV' | 'BS-VI' | 'CNG' | 'EV'
   * @param {number} params.distanceKm - Distance of the trip in kilometers
   * @param {number} params.payloadTons - Weight of cargo in metric tons
   * @param {number} [params.gradientFactor=1.0] - Topography gradient multiplier (default 1.0)
   * @returns {Object} Emission summary in kg CO2e and token reward metrics
   */
  calculateEmissions({ fuelClass, distanceKm, payloadTons, gradientFactor = 1.0 }) {
    if (!EMISSION_FACTORS[fuelClass]) {
      throw new Error(`Invalid or unsupported vehicle fuel class: ${fuelClass}`);
    }

    if (distanceKm <= 0 || payloadTons < 0) {
      throw new Error('Distance must be positive and payload cannot be negative');
    }

    const baseFactor = EMISSION_FACTORS[fuelClass];
    // Formula: Distance (km) * Payload (tons) * Base Factor (g/ton-km) * Gradient Multiplier / 1000 (to kg)
    const totalGrams = distanceKm * payloadTons * baseFactor * gradientFactor;
    const totalKgCO2e = Number((totalGrams / 1000).toFixed(2));

    logger.info(
      { fuelClass, distanceKm, payloadTons, totalKgCO2e },
      '[carbon-service] Scope 3 carbon footprint calculated successfully'
    );

    return {
      fuelClass,
      distanceKm,
      payloadTons,
      totalKgCO2e,
      isGreenEligible: fuelClass === 'EV' || fuelClass === 'CNG',
    };
  }

  /**
   * Mints Green Freight certificate data and awards driver Sentinel XP.
   */
  async processGreenFreightRewards(tripDetails) {
    const emissionData = this.calculateEmissions(tripDetails);

    if (!emissionData.isGreenEligible) {
      return { certified: false, xpAwarded: 0 };
    }

    // Award bonus Sentinel XP for green fleet operation
    const xpAwarded = tripDetails.fuelClass === 'EV' ? 250 : 100;

    logger.info(
      { tripId: tripDetails.tripId, xpAwarded },
      '[carbon-service] Minted Green Freight certificate & awarded driver Sentinel XP'
    );

    return {
      certified: true,
      tokenStandard: 'ERC-1155',
      network: 'Polygon',
      certificateMetadata: {
        co2SavedKg: emissionData.totalKgCO2e,
        issuedAt: new Date().toISOString(),
      },
      xpAwarded,
    };
  }
}

export default new CarbonService();
