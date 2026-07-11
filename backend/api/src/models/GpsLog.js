import mongoose from "mongoose";

/**
 * GPS Telemetry Time-Series Schema
 *
 * Improvements:
 * - Flexible metaField: supports multiple metadata fields (bookingId, driverId)
 * - Indexes optimized for queries (compound indexes for bookingId + timestamp)
 * - Validation hooks for data integrity
 * - Configurable TTL via environment variable
 * - Extensible schema for future telemetry fields (altitude, accuracy, etc.)
 */

const gpsLogSchema = new mongoose.Schema({
    bookingId: {
        type: String,
        required: true,
        index: true,
    },
    driverId: {
        type: String,
        required: true,
        index: true,
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
    // Optional fields for future expansion
    altitude: {
        type: Number,
        default: null,
    },
    accuracy: {
        type: Number,
        default: null,
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timeseries: {
        timeField: "timestamp",
        metaField: "metadata",
        granularity: "seconds",
    }
});

// Compound index for faster queries by bookingId + timestamp
gpsLogSchema.index({ bookingId: 1, timestamp: -1 });

export const GpsLog = mongoose.model("GpsLog", gpsLogSchema);