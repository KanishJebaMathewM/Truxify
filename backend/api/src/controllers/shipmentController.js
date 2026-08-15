import { createUserClient, supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

export const getShipmentDetails = async (req, res) => {
  try {
    const shipmentId = req.query.shipmentId || req.params.shipmentId;
    if (!shipmentId) {
      return res.status(400).json({ error: 'shipmentId is required' });
    }

    const db = createUserClient(req.token) || supabase;

    // Fetch the order (shipment) from the database
    const { data: shipment, error } = await db
      .from('orders')
      .select('*')
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
