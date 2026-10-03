const biometricAuthService = require('../services/biometricAuthService');

const verifyDriver = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { freightValue, biometricPayload } = req.body;

        if (!driverId || freightValue === undefined) {
            return res.status(400).json({ error: 'driverId and freightValue are required' });
        }

        const result = await biometricAuthService.authenticateForFreight(
            driverId,
            freightValue,
            biometricPayload
        );

        if (result.required && !result.verified) {
            return res.status(401).json(result);
        }

        return res.status(200).json({ success: true, data: result });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    verifyDriver,
};
