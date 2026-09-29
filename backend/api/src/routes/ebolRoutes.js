import express from 'express';
import {
  defaultCustodyService,
  processGeofencedSignature,
} from '../services/smartEbol.js';

const router = express.Router();

/**
 * POST /api/ebol/issue
 * Issues a new electronic Bill of Lading (eBL) with physical cargo tamper seals.
 */
router.post('/issue', (req, res) => {
  try {
    const {
      ebolId,
      shipperAddress,
      carrierAddress,
      consigneeAddress,
      tamperSeals,
      orderDisplayId,
      metadata,
    } = req.body;

    if (!ebolId || !shipperAddress || !carrierAddress || !consigneeAddress) {
      return res.status(400).json({
        success: false,
        error: 'ebolId, shipperAddress, carrierAddress, and consigneeAddress are required.',
      });
    }

    const record = defaultCustodyService.issueEbol({
      ebolId,
      shipperAddress,
      carrierAddress,
      consigneeAddress,
      tamperSeals: tamperSeals || [],
      orderDisplayId,
      metadata,
    });

    return res.status(201).json({
      success: true,
      data: record,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ebol/transition
 * Executes a sequential custody state transition verified with an EIP-712 digital signature.
 */
router.post('/transition', async (req, res) => {
  try {
    const {
      ebolId,
      toState,
      fromActor,
      toActor,
      signature,
      timestamp,
      nonce,
      tamperSealProof,
      orderDisplayId,
    } = req.body;

    if (!ebolId || !toState || !fromActor || !toActor || !signature || nonce === undefined) {
      return res.status(400).json({
        success: false,
        error: 'ebolId, toState, fromActor, toActor, signature, and nonce are required.',
      });
    }

    const updatedRecord = await defaultCustodyService.transitionCustody({
      ebolId,
      toState,
      fromActor,
      toActor,
      signature,
      timestamp: timestamp ? Number(timestamp) : undefined,
      nonce: Number(nonce),
      tamperSealProof,
      orderDisplayId,
    });

    return res.json({
      success: true,
      data: updatedRecord,
    });
  } catch (error) {
    return res.status(422).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ebol/inspection
 * Appends a weigh-station inspection token or cargo checkpoint seal to the Merkle tree.
 */
router.post('/inspection', (req, res) => {
  try {
    const { ebolId, inspectionDigest } = req.body;

    if (!ebolId || !inspectionDigest) {
      return res.status(400).json({
        success: false,
        error: 'ebolId and inspectionDigest are required.',
      });
    }

    const result = defaultCustodyService.addInspectionDigest(ebolId, inspectionDigest);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ebol/verify-seal
 * Verifies an O(log n) Merkle inclusion proof for a physical tamper seal.
 */
router.post('/verify-seal', (req, res) => {
  try {
    const { ebolId, leaf, proof } = req.body;

    if (!ebolId || !leaf || !Array.isArray(proof)) {
      return res.status(400).json({
        success: false,
        error: 'ebolId, leaf, and proof array are required.',
      });
    }

    const verified = defaultCustodyService.verifySealProof(ebolId, leaf, proof);

    return res.json({
      success: true,
      data: {
        ebolId,
        leaf,
        verified,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ebol/sign-geofenced
 * Geofenced signature endpoint supporting cryptographic signatures and tamper seals.
 */
router.post('/sign-geofenced', (req, res) => {
  try {
    const result = processGeofencedSignature(req.body);

    if (!result.signed) {
      return res.status(422).json({
        success: false,
        error: result.reason,
        message: result.message,
        proximityMetrics: result.proximityMetrics,
      });
    }

    return res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/ebol/:ebolId
 * Retrieves full eBL record, current custody state, and audit trail.
 */
router.get('/:ebolId', (req, res) => {
  try {
    const record = defaultCustodyService.getEbol(req.params.ebolId);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `eBL "${req.params.ebolId}" not found.`,
      });
    }

    return res.json({
      success: true,
      data: record,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/ebol/:ebolId/seal-proof/:leafOrIndex
 * Generates an O(log n) Merkle inclusion proof for a seal or index.
 */
router.get('/:ebolId/seal-proof/:leafOrIndex', (req, res) => {
  try {
    const { ebolId, leafOrIndex } = req.params;
    const isNumeric = /^\d+$/.test(leafOrIndex);
    const param = isNumeric ? parseInt(leafOrIndex, 10) : leafOrIndex;

    const proof = defaultCustodyService.getSealProof(ebolId, param);

    return res.json({
      success: true,
      data: {
        ebolId,
        proof,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
