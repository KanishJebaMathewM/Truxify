import { createUserClient, supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

// Whitelist of order columns exposed to the shipment owner / assigned driver.
// Never expose payment details (upi_id, payment_method_id), the delivery OTP
// and its verification timestamps, blockchain tx hashes, escrow internals,
// pending bid-acceptance context, or cancellation metadata.
const SHIPMENT_COLUMNS = [
  'id',
  'order_display_id',
  'customer_id',
  'driver_id',
  'truck_id',
  'status',
  'pickup_address',
  'pickup_lat',
  'pickup_lng',
  'drop_address',
  'drop_lat',
  'drop_lng',
  'pickup_date',
  'pickup_time',
  'goods_type',
  'weight_tonnes',
  'length_ft',
  'width_ft',
  'height_ft',
  'is_stackable',
  'is_fragile',
  'special_requirements',
  'base_freight',
  'toll_estimate',
  'platform_fee',
  'total_amount',
  'driver_name',
  'driver_rating',
  'truck_number',
  'eta',
  'created_at',
  'updated_at',
];

export const getShipmentDetails = async (req, res) => {
  try {
    const shipmentId = req.query.shipmentId || req.params.shipmentId;
    if (!shipmentId) {
      return res.status(400).json({ error: 'shipmentId is required' });
    }

    const db = createUserClient(req.token) || supabase;

    // Fetch the order (shipment) from the database, selecting only the safe
    // allowlist instead of '*' so payment/OTP/escrow internals never reach
    // the response.
    const { data: shipment, error } = await db
      .from('orders')
      .select(SHIPMENT_COLUMNS.join(', '))
      .eq('id', shipmentId)
      .single();

    if (error || !shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Authorization check: Verify if the authenticated user is the owner (customer) or driver
    // The issue states: "matches the ownerId of the requested shipment"
    // In our context, customer_id represents the owner, and driver_id is the assigned driver.
    const isOwner = shipment.customer_id === req.user.id;
    const isAssignedDriver = shipment.driver_id === req.user.id;
    if (!isOwner && !isAssignedDriver) {
      logger.warn({ userId: req.user.id, shipmentId }, 'Unauthorized access attempt to shipment details');
      return res.status(403).json({ error: 'Forbidden: You do not have access to this shipment.' });
    }

    return res.json({ success: true, data: shipment });
  } catch (error) {
    logger.error('Error fetching shipment details:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
