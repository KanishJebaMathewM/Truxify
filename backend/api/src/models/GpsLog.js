import mongoose from "mongoose";

const Schema = mongoose?.Schema || mongoose?.default?.Schema || class {};
const models = mongoose?.models || mongoose?.default?.models || {};
const model = (mongoose?.model || mongoose?.default?.model || (() => ({}))).bind(mongoose);

const gpsLogSchema = new Schema(
  {
    bookingId: { type: String, required: true, index: true },
    driverId:  { type: String, required: true },
    lat:       { type: Number, required: true },
    lng:       { type: Number, required: true },
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

const GpsLog = models.GpsLog || model("GpsLog", gpsLogSchema);

export { GpsLog };
export default GpsLog;