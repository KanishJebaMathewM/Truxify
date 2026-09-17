const mongoose = require("mongoose");

const gpsLogSchema = new mongoose.Schema(
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

module.exports = mongoose.models.GpsLog || mongoose.model("GpsLog", gpsLogSchema);