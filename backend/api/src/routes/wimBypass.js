import express from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { auditLog } from '../middleware/auditLog.js';
import { getMaxWimMeasurementAgeMs, hasWimSigningSecret } from '../config/wim.js';
import {
  evaluateBypassEligibility,
  buildTrustedMeasurement,
  validateTrustedMeasurement,
  storeWimMeasurement,
  buildCredential,
  createSignedWimPacket,
  storeWimCredential,
  verifyWimPacket,
  consumeWimCredential,
} from '../services/wimBypass.js';
import logger from '../middleware/logger.js';

const router = express.Router();

router.use(authenticate, userLimiter);

const requestBypassSchema = z
  .object({
    truckId: z.string().min(1, 'truckId is required'),
    bolId: z.string().min(1, 'bolId is required'),
  })
  // Never accept client-supplied measurement fields. safetyScore / axleWeight
  // / maxWeightLimit / timestamps in the request body are rejected outright
  // rather than silently trusted.
  .strict();

const verifyBypassSchema = z
  .object({
    wimPacket: z
      .object({
        packet: z.object({}).passthrough(),
        signature: z.string().min(1, 'signature is required'),
      })
      .strict(),
  })
  .strict();

router.post(
  '/request-bypass',
  requirePolicy('wim:request-bypass'),
  auditLog({
    action: 'wim:bypass-issued',
    resourceType: 'wim_bypass_credential',
    getMetadata: (req, res) => res.locals?.wimMetadata || null,
  }),
  validateBody(requestBypassSchema),
  async (req, res) => {
    const { truckId, bolId } = req.body;

    try {
      // Fail closed before doing any work: if the signing secret is not
      // configured, no credential can ever be issued safely.
      if (!hasWimSigningSecret()) {
        logger.error(
          { event: 'WIM_SIGNING_FAILURE', truckId, bolId, actorId: req.user.id },
          '[WIM] Signing secret unavailable; refusing to issue bypass credential.',
        );
        return res.status(500).json({ error: 'Unable to issue bypass credential.' });
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

      const measurement = buildTrustedMeasurement({ truck, order, driverProfile: profile });

      if (!Number.isFinite(measurement.weightLbs) || !Number.isFinite(measurement.capacityLbs)) {
        logger.warn('[WIM] Truck/load records missing weight data, failing closed:', { truckId, bolId });
        res.locals.wimMetadata = { outcome: 'rejected', reason: 'missing-weight-data', truckId, bolId };
        return res.json({
          signal: 'PULL_IN',
          message: 'Truck must pull into weigh station.',
        });
      }

      // Server-side freshness + vehicle/load correlation of the trusted measurement.
      const measurementCheck = validateTrustedMeasurement(measurement, {
        expectedTruckId: truck.id,
        expectedOrderDisplayId: order.order_display_id,
        maxAgeMs: getMaxWimMeasurementAgeMs(),
      });
      if (!measurementCheck.valid) {
        logger.warn('[WIM] Trusted measurement rejected:', { event: 'WIM_MEASUREMENT_REJECTED', reason: measurementCheck.reason, truckId, bolId });
        res.locals.wimMetadata = { outcome: 'rejected', reason: measurementCheck.reason, truckId, bolId };
        return res.json({
          signal: 'PULL_IN',
          message: 'Truck must pull into weigh station.',
        });
      }

      const isEligible = evaluateBypassEligibility({
        safetyScore: measurement.safetyScore,
        axleWeight: measurement.weightLbs,
        maxWeightLimit: measurement.capacityLbs,
      });

      if (!isEligible) {
        logger.warn('[WIM] Truck is not eligible for bypass:', { event: 'WIM_ELIGIBILITY_REJECTED', truckId, bolId, actorId: req.user.id });
        res.locals.wimMetadata = { outcome: 'rejected', reason: 'not-eligible', truckId, bolId };
        return res.json({
          signal: 'PULL_IN',
          message: 'Truck must pull into weigh station.',
        });
      }

      const storedMeasurement = await storeWimMeasurement(measurement);
      const credential = buildCredential({ measurement: storedMeasurement, eligibility: isEligible });
      const signedPacket = createSignedWimPacket(credential);
      await storeWimCredential(credential);

      logger.info(
        {
          event: 'WIM_BYPASS_ISSUED',
          credentialId: credential.credentialId,
          measurementId: storedMeasurement.id,
          truckId,
          bolId,
          actorId: req.user.id,
        },
        '[WIM] Bypass credential issued.',
      );

      res.locals.wimMetadata = {
        outcome: 'issued',
        credentialId: credential.credentialId,
        measurementId: storedMeasurement.id,
        truckId,
        bolId,
        actorId: req.user.id,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
      };

      return res.json({
        signal: 'BYPASS',
        message: 'Green signal: Cleared to bypass weigh station.',
        wimPacket: signedPacket,
      });
    } catch (error) {
      logger.error({ event: 'WIM_REQUEST_ERROR', error: error.message, truckId, bolId, actorId: req.user.id }, '[WIM] request-bypass error.');
      return res.status(500).json({ error: 'Unable to issue bypass credential.' });
    }
  },
);

router.post(
  '/verify-bypass',
  requirePolicy('wim:verify-bypass'),
  auditLog({
    action: 'wim:verify-bypass',
    resourceType: 'wim_bypass_credential',
    getMetadata: (req, res) => res.locals?.wimMetadata || null,
  }),
  validateBody(verifyBypassSchema),
  async (req, res) => {
    const { wimPacket } = req.body;

    try {
      const verification = verifyWimPacket(wimPacket);

      if (!verification.valid) {
        logger.warn(
          { event: 'WIM_VERIFY_REJECTED', reason: verification.reason, actorId: req.user.id },
          '[WIM] Bypass packet verification failed.',
        );
        res.locals.wimMetadata = { outcome: 'rejected', reason: verification.reason, actorId: req.user.id };
        const status = verification.reason === 'expired-credential' ? 403 : 400;
        return res.status(status).json({ valid: false, reason: verification.reason });
      }

      // Single-use semantics: atomically consume the credential. A replay or
      // an already-consumed credential cannot pass this step.
      const { packetData } = verification;
      const consumed = await consumeWimCredential(packetData.credentialId);

      if (!consumed) {
        logger.warn(
          { event: 'WIM_REPLAY_REJECTED', credentialId: packetData.credentialId, actorId: req.user.id },
          '[WIM] Bypass credential replay rejected.',
        );
        res.locals.wimMetadata = { outcome: 'rejected', reason: 'credential-already-consumed', credentialId: packetData.credentialId, actorId: req.user.id };
        return res.status(409).json({ valid: false, reason: 'credential-already-consumed' });
      }

      logger.info(
        { event: 'WIM_VERIFY_GRANTED', credentialId: packetData.credentialId, actorId: req.user.id },
        '[WIM] Bypass credential verified and consumed.',
      );
      res.locals.wimMetadata = { outcome: 'granted', credentialId: packetData.credentialId, actorId: req.user.id };

      return res.json({ valid: true, signal: 'BYPASS', credentialId: packetData.credentialId });
    } catch (error) {
      logger.error({ event: 'WIM_VERIFY_ERROR', error: error.message, actorId: req.user.id }, '[WIM] verify-bypass error.');
      return res.status(500).json({ error: 'Unable to verify bypass credential.' });
    }
  },
);

export default router;
