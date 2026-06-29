import mongoose from "mongoose";

/**
 * MongoDB Time-Series collection for GPS telemetry events.
 *
 * Uses MongoDB 5.0+ time-series collections for:
 * - Efficient time-range queries on GPS data
 * - Automatic compression of sequential GPS points
 * - Auto-purge after 30 days (TTL index)
 *
 * Schema design:
 *  - timeField: "timestamp" — the time dimension
 *  - metaField: "bookingId" — groups GPS points per trip
 */
const gpsLogSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      required: true,
      index: true,
    },
    driverId: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    speed: {
      type: Number,
      default: 0,
      min: 0,
    },
    heading: {
      type: Number,
      default: 0,
      min: 0,
      max: 360,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    // MongoDB 5.0+ time-series collection
    timeseries: {
      timeField: "timestamp",
      metaField: "bookingId",
      granularity: "seconds",
    },
    // Auto-purge GPS logs after 30 days
    expireAfterSeconds: 60 * 60 * 24 * 30,
  }
);

export const GpsLog = mongoose.model("GpsLog", gpsLogSchema);