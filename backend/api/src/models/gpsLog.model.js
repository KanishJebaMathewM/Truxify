// backend/api/src/models/gpsLog.model.js

import mongoose from 'mongoose';

const GpsLogSchema = new mongoose.Schema({
  tripId: { type: String, required: true, index: true },
  driverId: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  speed: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

// Automatically delete raw GPS logs older than 90 days (7,776,000 seconds)
GpsLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// Compound index for querying active trip trajectories efficiently
GpsLogSchema.index({ tripId: 1, timestamp: -1 });

export const GpsLog = mongoose.model('GpsLog', GpsLogSchema);
