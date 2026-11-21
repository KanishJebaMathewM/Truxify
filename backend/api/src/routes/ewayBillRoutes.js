const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const ewayBillService = require('../services/ewayBillService');
const auditAnchorService = require('../services/auditAnchorService');
const ewayExpiryWatcher = require('../workers/ewayExpiryWatcher');

const router = express.Router();
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/eway-bills/verify
 * Verifies e-Way Bill on NIC portal during load creation and anchors SHA-256 hash on Polygon.
 */
router.post('/verify', async (req, res) => {
    try {
        const { orderId, ewbNumber, invoiceValue, expectedVehicleNumber } = req.body;
        const result = await ewayBillService.verifyAndAttachToOrder({
            orderId,
            ewbNumber,
            invoiceValue,
            expectedVehicleNumber,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/eway-bills/:ewbNumber/extend
 * Manually or programmatically triggers NIC e-Way Bill extension.
 */
router.post('/:ewbNumber/extend', async (req, res) => {
    try {
        const { ewbNumber } = req.params;
        const {
            currentLat,
            currentLng,
            currentPlace,
            currentStateCode,
            remainingDistanceKm,
            reasonCode,
            reasonRemark,
        } = req.body;

        const result = await ewayBillService.extendEwayBillValidity({
            ewbNumber,
            currentLat,
            currentLng,
            currentPlace,
            currentStateCode,
            remainingDistanceKm,
            reasonCode,
            reasonRemark,
        });

        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/eway-bills/telemetry-ping
 * Hook for driver WebSocket gateway to feed GPS velocity into the predictive expiry watcher.
 */
router.post('/telemetry-ping', async (req, res) => {
    try {
        const result = await ewayExpiryWatcher.processTelemetryPing(req.body);
        return res.status(200).json({ success: true, result });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/eway-bills/inspect/:ewbNumber
 * Public QR verification endpoint for RTO / GST transport inspectors.
 * Compares live Supabase metadata SHA-256 hash against the immutable Polygon record.
 */
router.get('/inspect/:ewbNumber', async (req, res) => {
    try {
        const { ewbNumber } = req.params;
        const { data: record, error } = await supabase
            .from('eway_bills')
            .select('*')
            .eq('ewb_number', ewbNumber)
            .single();

        if (error || !record) {
            return res.status(404).json({ success: false, error: 'e-Way Bill not found' });
        }

        const verification = await auditAnchorService.verifyOnChain({
            ewbNumber: record.ewb_number,
            consignorGstin: record.consignor_gstin,
            consigneeGstin: record.consignee_gstin,
            invoiceValue: record.invoice_value,
            vehicleNumber: record.vehicle_number,
            originPincode: record.origin_pincode,
            destinationPincode: record.destination_pincode,
            validUpto: record.valid_upto,
        });

        const isExpired = new Date(record.valid_upto).getTime() < Date.now();

        return res.status(200).json({
            success: true,
            ewbNumber: record.ewb_number,
            vehicleNumber: record.vehicle_number,
            status: isExpired ? 'EXPIRED' : record.status,
            validUpto: record.valid_upto,
            extensionCount: record.extension_count,
            polygonTxHash: record.polygon_tx_hash,
            blockchainVerification: verification,
            auditHistory: record.audit_history,
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;