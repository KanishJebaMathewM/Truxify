import express from 'express';
import { supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { evaluateBypassEligibility, createSignedWimPacket } from '../services/wimBypass.js';
import logger from '../middleware/logger.js';

const router = express.Router();

router.use(authenticate, requireRole(['driver']), userLimiter);

const LBS_PER_TONNE = 2000;

router.post('/request-bypass', async (req, res) => {
    try {
        const { truckId, bolId } = req.body;

        if (!truckId || !bolId) {
            return res.status(400).json({ error: 'Missing required truck/load parameters' });
        }

        // Never trust client-supplied safetyScore / axleWeight / maxWeightLimit.
        // Resolve every eligibility input from server-side records: the truck's
        // registered capacity and the load's registered weight, scoped to the
        // authenticated driver.
        const [{ data: truck, error: truckErr }, { data: order, error: orderErr }] = await Promise.all([
            supabaseAdmin
                .from('trucks')
                .select('id, driver_id, max_capacity_tons')
                .eq('id', truckId)
                .maybeSingle(),
            supabaseAdmin
                .from('orders')
                .select('id, order_display_id, driver_id, truck_id, weight_tonnes')
                .eq('order_display_id', bolId)
                .maybeSingle(),
        ]);

        if (truckErr || orderErr) {
            logger.error('[WIM] Failed to resolve truck/load records:', { truckErr: truckErr?.message, orderErr: orderErr?.message });
            return res.status(500).json({ error: 'Failed to verify truck/load records.' });
        }

        if (!truck) {
            return res.status(404).json({ error: 'Truck not found.' });
        }

        if (truck.driver_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden: You do not own this truck.' });
        }

        if (!order || order.driver_id !== req.user.id || order.truck_id !== truck.id) {
            return res.status(403).json({ error: 'Forbidden: Load is not assigned to this truck.' });
        }

        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('is_digilocker_verified')
            .eq('id', req.user.id)
            .maybeSingle();

        if (profileErr) {
            logger.error('[WIM] Failed to resolve driver verification:', profileErr.message);
            return res.status(500).json({ error: 'Failed to verify driver registration.' });
        }

        const maxWeightLimit = Number(truck.max_capacity_tons) * LBS_PER_TONNE;
        const axleWeight = Number(order.weight_tonnes) * LBS_PER_TONNE;
        // There is no safety-score column in the schema; derive the safety
        // signal from the driver's verified registration (fail closed to 0).
        const safetyScore = profile?.is_digilocker_verified ? 100 : 0;

        if (!Number.isFinite(axleWeight) || !Number.isFinite(maxWeightLimit)) {
            logger.warn('[WIM] Truck/load records missing weight data, failing closed:', { truckId, bolId });
            return res.json({
                signal: 'PULL_IN',
                message: 'Truck must pull into weigh station.',
            });
        }

        const isEligible = evaluateBypassEligibility({
            safetyScore,
            axleWeight,
            maxWeightLimit,
        });

        if (!isEligible) {
            return res.json({
                signal: 'PULL_IN',
                message: 'Truck must pull into weigh station.',
            });
        }

        const signedPacket = createSignedWimPacket({
            truckId: truck.id,
            safetyScore,
            bolId: order.order_display_id,
            axleWeight,
        });

        return res.json({
            signal: 'BYPASS',
            message: 'Green signal: Cleared to bypass weigh station.',
            wimPacket: signedPacket,
        });
    } catch (error) {
        logger.error('[WIM] request-bypass error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

export default router;
