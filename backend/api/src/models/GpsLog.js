import mongoose from 'mongoose';

const gpsLogSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, index: true },
    driverId:  { type: String, required: true },
    lat:       { type: Number, required: true, min: -90, max: 90 },
    lng:       { type: Number, required: true, min: -180, max: 180 },
    speed:     { type: Number, default: null },
    heading:   { type: Number, default: null },
    timestamp: { type: Date,   required: true, index: true },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "bookingId",
      granularity: "seconds",
    },
    expireAfterSeconds: 60 * 60 * 24 * 30, // 30-day auto-purge
  }
);

export default mongoose.models.GpsLog || mongoose.model("GpsLog", gpsLogSchema);