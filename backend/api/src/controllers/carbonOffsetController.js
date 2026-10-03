const carbonOffsetService = require('../services/carbonOffsetService');

const getFootprint = async (req, res) => {
    try {
        const { distanceKm, weightKg } = req.query;

        if (!distanceKm || !weightKg) {
            return res.status(400).json({ error: 'distanceKm and weightKg are required' });
        }

        const distance = Number(distanceKm);
        const weight = Number(weightKg);

        if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(weight) || weight <= 0) {
            return res.status(400).json({ error: 'distanceKm and weightKg must be positive finite numbers' });
        }

        const footprint = carbonOffsetService.calculateFootprint(
            distance,
            weight
        );

        return res.status(200).json({ success: true, carbonTons: footprint });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const listPackages = async (req, res) => {
    try {
        const packages = carbonOffsetService.getOffsetPackages();
        return res.status(200).json({ success: true, data: packages });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const buyOffset = async (req, res) => {
    try {
        const { userId, packageId, shipmentId } = req.body;

        if (!userId || !packageId) {
            return res.status(400).json({ error: 'userId and packageId are required' });
        }

        const result = await carbonOffsetService.purchaseOffset(userId, packageId, shipmentId);
        return res.status(201).json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getFootprint,
    listPackages,
    buyOffset,
};
