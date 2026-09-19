import platooningCoordinatorService from '../services/platooningCoordinatorService.js';

export const findPartners = async (req, res) => {
  try {
    const { truckId, highwayRoute, currentSpeedMph, currentLat, currentLng } = req.query;

    const partners = await platooningCoordinatorService.findPlatoonPartners({
      truckId: truckId || req.user?.id || 'TRX-DEFAULT',
      highwayRoute,
      currentSpeedMph: currentSpeedMph ? Number(currentSpeedMph) : 65,
      currentLat: currentLat ? Number(currentLat) : undefined,
      currentLng: currentLng ? Number(currentLng) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: partners,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Failed to find platoon partners',
    });
  }
};

export const createSession = async (req, res) => {
  try {
    const { leadTruckId, leadDriverName, followerTruckId, followerDriverName, targetSpeedMph } = req.body;

    const session = platooningCoordinatorService.createPlatoonSession({
      leadTruckId,
      leadDriverName,
      followerTruckId,
      followerDriverName,
      targetSpeedMph,
    });

    return res.status(201).json({
      success: true,
      data: session,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Failed to create platoon session',
    });
  }
};

export const updateTelemetry = async (req, res) => {
  try {
    const { platoonId } = req.params;
    const { distanceCoveredMiles, currentSpeedMph } = req.body;

    const updated = platooningCoordinatorService.processTelemetry(platoonId, {
      distanceCoveredMiles: Number(distanceCoveredMiles) || 1.0,
      currentSpeedMph: currentSpeedMph ? Number(currentSpeedMph) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Failed to update telemetry',
    });
  }
};

export const emergencyDecouple = async (req, res) => {
  try {
    const { platoonId } = req.params;
    const { accelerationMps2, manualOverride } = req.body;

    const result = platooningCoordinatorService.evaluateSafetyAndDecouple(platoonId, {
      accelerationMps2: Number(accelerationMps2) || 0,
      manualOverride: Boolean(manualOverride),
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Failed to evaluate safety decoupling',
    });
  }
};

export const disengage = async (req, res) => {
  try {
    const { platoonId } = req.params;

    const result = platooningCoordinatorService.disengagePlatoon(platoonId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Failed to disengage platoon',
    });
  }
};

export default {
  findPartners,
  createSession,
  updateTelemetry,
  emergencyDecouple,
  disengage,
};
