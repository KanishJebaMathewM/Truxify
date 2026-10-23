import { CorridorService } from './corridorService.js';
import { SpatialMatcher } from './spatialMatcher.js';
import { ProfitabilityScorer } from './profitabilityScorer.js';
import { DriverDispatchPipeline } from './driverDispatchPipeline.js';

export const defaultCorridorService = new CorridorService();
export const defaultSpatialMatcher = new SpatialMatcher();
export const defaultProfitabilityScorer = new ProfitabilityScorer();
export const defaultDriverDispatchPipeline = new DriverDispatchPipeline();

export {
  CorridorService,
  SpatialMatcher,
  ProfitabilityScorer,
  DriverDispatchPipeline,
};

export default defaultDriverDispatchPipeline;
