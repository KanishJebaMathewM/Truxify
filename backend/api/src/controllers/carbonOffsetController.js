const carbonOffsetService = require('../services/carbonOffsetService');

const getFootprint = async (req, res) => {
    try {
        const { distanceKm, weightKg } = req.query;

        if (!distanceKm || !weightKg) {
            return res.status(400).json({ error: 'distanceKm and weightKg are required' });
        }

        const footprint = carbonOffsetService.calculateFootprint(
            parseFloat(distanceKm),
            parseFloat(weightKg)
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
