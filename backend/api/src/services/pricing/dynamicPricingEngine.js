import { TollCostMatrix } from './tollCostMatrix.js';
import { DieselIndexAggregator } from './dieselIndexAggregator.js';
import { QuoteTokenService } from './quoteTokenService.js';
import logger from '../../middleware/logger.js';

export const VEHICLE_BASE_RATES_PAISA_PER_KM = Object.freeze({
  LCV: 2200,          // ₹22.00 / km (Tata Ace, Bolero Maxi Truck)
  HCV_2_AXLE: 4500,   // ₹45.00 / km (10-Tonne Eicher / BharatBenz)
  HCV_3_AXLE: 6200,   // ₹62.00 / km (16-Tonne Taurus)
  TRAILER_MULTI: 9500,// ₹95.00 / km (28-40 Tonne Heavy Multi-Axle)
});

export class DynamicPricingEngine {
  constructor(options = {}) {
    this.tollMatrix = new TollCostMatrix(options);
    this.dieselAggregator = new DieselIndexAggregator(options);
    this.tokenService = new QuoteTokenService(options);
    this.platformFeePct = options.platformFeePct || 5.0; // 5%
  }

  /**
   * Calculates a dynamic freight quote and generates a signed 15-minute token.
   * 
   * Formula:
   * Price = (Distance * BaseRatePerKm) + TollCost + [BaseFreight * (FuelMultiplier - 1.0) * DemandSupplyIndex] + DeadheadRiskPremium
   * 
   * @param {object} params
   * @param {number} params.distanceKm - Trip distance in kilometers
   * @param {string} [params.vehicleClass='HCV_2_AXLE'] - Vehicle category
   * @param {string} [params.originState='DEFAULT'] - Origin state for fuel index
   * @param {string[]} [params.statesCrossed=[]] - State codes along the highway route
   * @param {number} [params.demandSupplyIndex=1.0] - Surge multiplier (0.85 to 1.80)
   * @param {number} [params.deadheadRiskScore=0.0] - Deadhead return probability (0.0 to 1.0)
   * @returns {Promise<object>} Itemized quote with signed quoteToken
   */
  async calculateQuote(params) {
    const {
      distanceKm = 0,
      vehicleClass = 'HCV_2_AXLE',
      originState = 'DEFAULT',
      statesCrossed = [],
      demandSupplyIndex = 1.0,
      deadheadRiskScore = 0.0,
    } = params;

    const vClass = vehicleClass.toUpperCase();
    const ratePerKm = VEHICLE_BASE_RATES_PAISA_PER_KM[vClass] || VEHICLE_BASE_RATES_PAISA_PER_KM.HCV_2_AXLE;

    // 1. Base Freight Distance Cost
    const baseFreightPaisa = Math.round(distanceKm * ratePerKm);

    // 2. NHAI FASTag Toll & Border Taxes
    const tollResult = this.tollMatrix.calculateTollAndTaxes({
      distanceKm,
      vehicleClass: vClass,
      statesCrossed,
    });
    const tollCostPaisa = tollResult.totalPaisa;

    // 3. Diesel Price Multiplier & Surcharge Calculation
    const dieselInfo = await this.dieselAggregator.getDieselIndex(originState);
    const clampedDemandIndex = Math.max(0.8, Math.min(2.0, Number(demandSupplyIndex) || 1.0));
    
    // Fuel surcharge adjustment
    const fuelDeltaMultiplier = Math.max(0, dieselInfo.fuelMultiplier - 1.0);
    const fuelSurchargePaisa = Math.round(baseFreightPaisa * fuelDeltaMultiplier * clampedDemandIndex);

    // 4. Deadhead Return Trip Risk Premium (up to 20% surcharge if destination has 0 return loads)
    const clampedDeadheadScore = Math.max(0, Math.min(1.0, Number(deadheadRiskScore) || 0.0));
    const deadheadRiskPremiumPaisa = Math.round(baseFreightPaisa * 0.20 * clampedDeadheadScore);

    // 5. Total Price Assembly
    const subtotalPaisa = baseFreightPaisa + tollCostPaisa + fuelSurchargePaisa + deadheadRiskPremiumPaisa;
    const platformFeePaisa = Math.round((subtotalPaisa * this.platformFeePct) / 100);
    const totalPaisa = subtotalPaisa + platformFeePaisa;
    const driverNetPayoutPaisa = subtotalPaisa - platformFeePaisa;

    // 6. Issue HMAC-Signed Quote Token
    const tokenResult = this.tokenService.generateQuoteToken({
      totalPaisa,
      baseFreightPaisa,
      tollPaisa: tollCostPaisa,
      fuelSurchargePaisa,
      distanceKm,
      vehicleClass: vClass,
    });

    const quoteResponse = {
      quoteId: tokenResult.quoteId,
      quoteToken: tokenResult.quoteToken,
      expiresAt: tokenResult.expiresAt,
      ttlRemainingSeconds: tokenResult.ttlRemainingSeconds,
      financials: {
        totalPaisa,
        totalInr: Number((totalPaisa / 100).toFixed(2)),
        driverNetPayoutInr: Number((driverNetPayoutPaisa / 100).toFixed(2)),
        platformFeeInr: Number((platformFeePaisa / 100).toFixed(2)),
      },
      itemizedBreakdown: {
        distanceKm: Number(distanceKm.toFixed(1)),
        vehicleClass: vClass,
        baseFreightPaisa,
        baseFreightInr: Number((baseFreightPaisa / 100).toFixed(2)),
        tollCostPaisa,
        tollCostInr: Number((tollCostPaisa / 100).toFixed(2)),
        tollPlazasEstimated: tollResult.estimatedPlazas,
        fuelSurchargePaisa,
        fuelSurchargeInr: Number((fuelSurchargePaisa / 100).toFixed(2)),
        dieselPumpPriceInr: dieselInfo.currentPriceInr,
        fuelMultiplier: dieselInfo.fuelMultiplier,
        demandSupplyMultiplier: clampedDemandIndex,
        deadheadRiskPremiumPaisa,
        deadheadRiskPremiumInr: Number((deadheadRiskPremiumPaisa / 100).toFixed(2)),
      },
    };

    logger.info(
      { quoteId: quoteResponse.quoteId, totalInr: quoteResponse.financials.totalInr },
      '[DynamicPricingEngine] Generated dynamic quote'
    );

    return quoteResponse;
  }

  /**
   * Validates a quote token prior to booking confirmation.
   * 
   * @param {string} quoteToken
   * @returns {{isValid: boolean, reason?: string, payload?: object}}
   */
  verifyQuote(quoteToken) {
    return this.tokenService.verifyQuoteToken(quoteToken);
  }
}

export default DynamicPricingEngine;
