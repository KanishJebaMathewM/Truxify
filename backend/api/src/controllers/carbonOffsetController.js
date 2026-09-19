import {
  calculateFootprint,
  getOffsetPackages,
  purchaseOffset,
  verifyCarbonCertificate,
} from '../services/carbonOffsetService.js';
import logger from '../middleware/logger.js';

export const getEstimate = (req, res) => {
  try {
    const { distanceKm, weightKg, fuelType, vehicleClass, emptyBackhaulPercent } = req.query;

    if (distanceKm === undefined || weightKg === undefined) {
      return res.status(400).json({ success: false, error: 'distanceKm and weightKg query parameters are required' });
    }

    const dist = parseFloat(distanceKm);
    const weight = parseFloat(weightKg);

    if (isNaN(dist) || dist < 0 || isNaN(weight) || weight < 0) {
      return res.status(400).json({ success: false, error: 'distanceKm and weightKg must be non-negative numbers' });
    }

    const data = calculateFootprint({
      distanceKm: dist,
      weightKg: weight,
      fuelType,
      vehicleClass,
      emptyBackhaulPercent: parseFloat(emptyBackhaulPercent) || 0,
    });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error({ err: err.message }, 'Carbon footprint estimation failed');
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const listPackages = (_req, res) => {
  try {
    const packages = getOffsetPackages();
    return res.status(200).json({ success: true, data: packages });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const buyOffset = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.uid || req.body?.userId;
    const { packageId, shipmentId } = req.body;

    if (!packageId || !shipmentId) {
      return res.status(400).json({ success: false, error: 'packageId and shipmentId are required' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required to purchase carbon offsets' });
    }

    const receipt = await purchaseOffset(userId, packageId, shipmentId);
    return res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    logger.error({ err: err.message }, 'Carbon offset purchase failed');
    return res.status(400).json({ success: false, error: err.message });
  }
};

export const verifyCertificate = (req, res) => {
  try {
    const certificate = req.body;
    const verification = verifyCarbonCertificate(certificate);

    if (!verification.valid) {
      return res.status(422).json({ success: false, error: verification.reason });
    }

    return res.status(200).json({ success: true, message: 'Certificate signature verified authentic', verification });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export default {
  getEstimate,
  listPackages,
  buyOffset,
  verifyCertificate,
};
