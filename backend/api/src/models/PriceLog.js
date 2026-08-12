import mongoose from 'mongoose';

const priceLogSchema = new mongoose.Schema({
  order_id: { type: String, required: true, index: true },
  predicted_price: { type: Number, required: true },
  accepted_price: { type: Number, required: true },
  distance_km: { type: Number },
  weight_tonnes: { type: Number },
  created_at: { type: Date, default: Date.now, index: true }
});

export const PriceLog = mongoose.model('PriceLog', priceLogSchema);
