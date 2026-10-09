import { DynamicPricingEngine } from './dynamicPricingEngine.js';
import { TollCostMatrix, VEHICLE_TOLL_RATES_PAISA_PER_KM, STATE_BORDER_TAXES_PAISA } from './tollCostMatrix.js';
import { DieselIndexAggregator, BASE_BENCHMARK_DIESEL_INR } from './dieselIndexAggregator.js';
import { QuoteTokenService, DEFAULT_QUOTE_TTL_SECONDS } from './quoteTokenService.js';

export const defaultDynamicPricingEngine = new DynamicPricingEngine();

export {
  DynamicPricingEngine,
  TollCostMatrix,
  DieselIndexAggregator,
  QuoteTokenService,
  VEHICLE_TOLL_RATES_PAISA_PER_KM,
  STATE_BORDER_TAXES_PAISA,
  BASE_BENCHMARK_DIESEL_INR,
  DEFAULT_QUOTE_TTL_SECONDS,
};

export default defaultDynamicPricingEngine;
