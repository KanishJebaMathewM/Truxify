/**
 * TollCostMatrix: NHAI FASTag Toll & State Border Tax Calculation Service
 * 
 * Computes deterministic toll fee estimates and commercial entry taxes
 * along Indian National Highway corridors based on vehicle category and route length.
 */

export const VEHICLE_TOLL_RATES_PAISA_PER_KM = Object.freeze({
  LCV: 140,         // ₹1.40 / km (Light Commercial Vehicle)
  HCV_2_AXLE: 290,  // ₹2.90 / km (Standard 2-Axle Truck / Bus)
  HCV_3_AXLE: 420,  // ₹4.20 / km (3-Axle Commercial Vehicle)
  TRAILER_MULTI: 580, // ₹5.80 / km (4-6 Axle Heavy Freight Trailer)
});

// State commercial goods entry taxes / border crossing cess (in paisa)
export const STATE_BORDER_TAXES_PAISA = Object.freeze({
  DELHI_NCR: 140000,    // ₹1,400 MCD Entry Tax / ECC
  MAHARASHTRA: 80000,   // ₹800 Border entry permit
  UTTAR_PRADESH: 60000, // ₹600 Transit tax
  GUJARAT: 50000,       // ₹500 Entry cess
  HARYANA: 40000,       // ₹400 Commercial road tax
  DEFAULT: 30000,       // ₹300 Standard interstate crossing
});

export class TollCostMatrix {
  /**
   * Calculates estimated toll cost for a route.
   * 
   * @param {object} params
   * @param {number} params.distanceKm - Route distance in kilometers
   * @param {string} [params.vehicleClass='HCV_2_AXLE'] - Vehicle category
   * @param {string[]} [params.statesCrossed=[]] - Array of state codes crossed along route
   * @param {number} [params.plazaCount] - Explicit number of NHAI toll plazas if known
   * @returns {object} { tollPaisa, borderTaxPaisa, totalPaisa, breakdown }
   */
  calculateTollAndTaxes(params) {
    const {
      distanceKm = 0,
      vehicleClass = 'HCV_2_AXLE',
      statesCrossed = [],
      plazaCount,
    } = params;

    const ratePerKm = VEHICLE_TOLL_RATES_PAISA_PER_KM[vehicleClass.toUpperCase()] ||
      VEHICLE_TOLL_RATES_PAISA_PER_KM.HCV_2_AXLE;

    // Estimate NHAI toll cost based on distance and vehicle category
    const estimatedPlazas = Number.isFinite(plazaCount) && plazaCount >= 0
      ? plazaCount
      : Math.max(1, Math.round(distanceKm / 65)); // Avg ~1 toll plaza every 65 km on NH network

    const baseTollPaisa = Math.round(distanceKm * ratePerKm);

    // Calculate state entry taxes
    let borderTaxPaisa = 0;
    const borderTaxDetails = [];

    if (Array.isArray(statesCrossed) && statesCrossed.length > 1) {
      // Shippers cross n-1 border checkpoints
      const borderCrossings = statesCrossed.slice(1);
      for (const state of borderCrossings) {
        const stateKey = state.toUpperCase().replace(/\s+/g, '_');
        const taxAmount = STATE_BORDER_TAXES_PAISA[stateKey] || STATE_BORDER_TAXES_PAISA.DEFAULT;
        borderTaxPaisa += taxAmount;
        borderTaxDetails.push({ state, taxPaisa: taxAmount });
      }
    }

    const totalPaisa = baseTollPaisa + borderTaxPaisa;

    return {
      tollPaisa: baseTollPaisa,
      borderTaxPaisa,
      totalPaisa,
      estimatedPlazas,
      vehicleClass,
      breakdown: {
        ratePerKmPaisa: ratePerKm,
        distanceKm: Number(distanceKm.toFixed(1)),
        borderTaxDetails,
      },
    };
  }
}

export default TollCostMatrix;
