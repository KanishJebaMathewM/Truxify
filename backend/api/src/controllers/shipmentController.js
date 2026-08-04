import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

export const getShipmentDetails = async (req, res) => {
  try {
    const shipmentId = req.query.shipmentId || req.params.shipmentId;
    
    if (!shipmentId) {
      return res.status(400).json({ error: 'shipmentId is required' });
    }

    const userId = req.user.id;

    const { data: shipment, error } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'Failed to fetch shipment details');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Verify that the userId associated with the JWT token matches the ownerId of the requested shipment
    if (shipment.ownerId !== userId && shipment.owner_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to view this shipment' });
    }

    return res.json({ data: shipment });
  } catch (error) {
    logger.error({ error }, 'Error fetching shipment details');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
