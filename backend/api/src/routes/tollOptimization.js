import express from 'express';
import { optimizeTollRoutes } from '../services/tollOptimization.js';

const router = express.Router();

router.post('/optimize', (req, res) => {
    try {
        const { routes, loadDetails } = req.body;

        if (!routes || !Array.isArray(routes) || routes.length === 0) {
            return res.status(400).json({ error: 'Array of candidate routes is required.' });
        }

        const result = optimizeTollRoutes(routes, loadDetails);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
