import { calculateTireWear } from '../services/tireWearService.js';

const getTireWearPrediction = async (req, res) => {
    try {
        const { driverId } = req.params;

        if (!driverId) {
            return res.status(400).json({ error: 'driverId is required' });
        }

        const prediction = await calculateTireWear(driverId);
        return res.status(200).json({ success: true, data: prediction });
    } catch (err) {
        console.error('Tire wear controller error:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

export { getTireWearPrediction };
