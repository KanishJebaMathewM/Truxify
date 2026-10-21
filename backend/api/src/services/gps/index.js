import { GpsStreamIngestionService, GPS_STREAM_KEY, GPS_STREAM_GROUP } from './gpsStreamIngestionService.js';
import { KalmanFilter2D } from './kalmanFilter.js';
import { HmmMapMatcher } from './hmmMapMatcher.js';
import { GeofenceEvaluator, calculateHaversineDistanceMeters } from './geofenceEvaluator.js';
import { BatchTrajectoryPersistence } from './batchTrajectoryPersistence.js';

export const defaultGpsStreamIngestionService = new GpsStreamIngestionService();
export const defaultMapMatcher = new HmmMapMatcher();
export const defaultBatchPersistence = new BatchTrajectoryPersistence();

export {
  GpsStreamIngestionService,
  KalmanFilter2D,
  HmmMapMatcher,
  GeofenceEvaluator,
  BatchTrajectoryPersistence,
  calculateHaversineDistanceMeters,
  GPS_STREAM_KEY,
  GPS_STREAM_GROUP,
};

export default defaultGpsStreamIngestionService;
