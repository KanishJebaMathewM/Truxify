const { createClient } = require('@supabase/supabase-js');
const auditAnchorService = require('./auditAnchorService');

const GST_THRESHOLD_INR = 50000;
const NIC_EXTENSION_WINDOW_HOURS = 8;

class EwayBillService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        this.gspBaseUrl = process.env.NIC_GSP_BASE_URL || 'https://api.gsp-sandbox.in/ewb/v1.03';
        this.gspClientId = process.env.NIC_GSP_CLIENT_ID || '';
        this.gspClientSecret = process.env.NIC_GSP_CLIENT_SECRET || '';
        this.gstin = process.env.TRANSPORTER_GSTIN || '';
    }

    /**
     * Calls NIC / GSP API to verify e-Way Bill details upon load creation.
     */
    async fetchFromNicPortal(ewbNumber) {
        if (!/^\d{12}$/.test(String(ewbNumber))) {
            throw new Error('Invalid e-Way Bill number: must be a 12-digit numeric code.');
        }

        // Fallback mock mode when sandbox credentials are not set in local dev
        if (!this.gspClientId || !this.gspClientSecret) {
            const validUpto = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            return {
                ewbNo: String(ewbNumber),
                status: 'ACT',
                fromGstin: '27AAACT2727Q1ZV',
                toGstin: '29AABCU9603R1ZM',
                totInvValue: 185000,
                vehicleNo: 'MH12AB1234',
                fromPincode: '411001',
                toPincode: '560001',
                actualDist: 840,
                validUpto,
            };
        }

        const response = await fetch(`${this.gspBaseUrl}/ewayapi/GetEwayBill?ewbNo=${ewbNumber}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'client-id': this.gspClientId,
                'client-secret': this.gspClientSecret,
                gstin: this.gstin,
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`NIC GSP verification failed (${response.status}): ${errText}`);
        }

        const data = await response.json();
        if (data.status !== 'ACT') {
            throw new Error(`e-Way Bill ${ewbNumber} is not active on NIC portal (status: ${data.status}).`);
        }

        return data;
    }

    /**
     * Validates consignment threshold (> ₹50,000), verifies on NIC portal, persists to Supabase,
     * and anchors initial state hash on Polygon.
     */
    async verifyAndAttachToOrder({ orderId, ewbNumber, invoiceValue, expectedVehicleNumber }) {
        if (Number(invoiceValue) <= GST_THRESHOLD_INR) {
            return {
                required: false,
                message: `Consignment value ₹${invoiceValue} is within ₹${GST_THRESHOLD_INR}; e-Way Bill optional.`,
            };
        }

        if (!ewbNumber) {
            throw new Error('An active 12-digit GST e-Way Bill is mandatory for shipments exceeding ₹50,000.');
        }

        const nicData = await this.fetchFromNicPortal(ewbNumber);

        const normalizedExpectedVehicle = String(expectedVehicleNumber || '')
            .replace(/\s+/g, '')
            .toUpperCase();
        const normalizedNicVehicle = String(nicData.vehicleNo || '')
            .replace(/\s+/g, '')
            .toUpperCase();

        if (normalizedExpectedVehicle && normalizedExpectedVehicle !== normalizedNicVehicle) {
            throw new Error(
                `Vehicle mismatch: NIC Part-B lists ${normalizedNicVehicle}, but order assigned ${normalizedExpectedVehicle}.`
            );
        }

        const metadata = {
            ewbNumber: String(ewbNumber),
            consignorGstin: nicData.fromGstin,
            consigneeGstin: nicData.toGstin,
            invoiceValue: Number(nicData.totInvValue || invoiceValue),
            vehicleNumber: normalizedNicVehicle,
            originPincode: String(nicData.fromPincode),
            destinationPincode: String(nicData.toPincode),
            validUpto: new Date(nicData.validUpto).toISOString(),
        };

        const anchorResult = await auditAnchorService.anchorConsignmentState(metadata, 'CREATED');

        const auditEntry = {
            event: 'CREATED',
            timestamp: new Date().toISOString(),
            validUpto: metadata.validUpto,
            vehicleNumber: metadata.vehicleNumber,
            sha256: anchorResult.sha256Hex,
            polygonTxHash: anchorResult.txHash,
        };

        const { data: savedRecord, error } = await this.supabase
            .from('eway_bills')
            .upsert(
                {
                    order_id: orderId,
                    ewb_number: metadata.ewbNumber,
                    consignor_gstin: metadata.consignorGstin,
                    consignee_gstin: metadata.consigneeGstin,
                    invoice_value: metadata.invoiceValue,
                    vehicle_number: metadata.vehicleNumber,
                    origin_pincode: metadata.originPincode,
                    destination_pincode: metadata.destinationPincode,
                    remaining_distance_km: Number(nicData.actualDist || 0),
                    valid_upto: metadata.validUpto,
                    status: 'VERIFIED',
                    payload_sha256: anchorResult.sha256Hex,
                    polygon_tx_hash: anchorResult.txHash,
                    audit_history: [auditEntry],
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'ewb_number' }
            )
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to save verified e-Way Bill: ${error.message}`);
        }

        return {
            required: true,
            ewayBill: savedRecord,
            anchor: anchorResult,
        };
    }

    /**
     * Triggers NIC e-Way Bill Validity Extension within the legal 8-hour pre/post expiry window
     * and re-anchors the updated validity timestamp on Polygon.
     */
    async extendEwayBillValidity({
        ewbNumber,
        currentLat,
        currentLng,
        currentPlace,
        currentStateCode,
        remainingDistanceKm,
        reasonCode = 4, // 4 = Natural Calamity / Traffic / Breakdown delay
        reasonRemark = 'Transit delay detected via live GPS telemetry',
    }) {
        const { data: record, error } = await this.supabase
            .from('eway_bills')
            .select('*')
            .eq('ewb_number', ewbNumber)
            .single();

        if (error || !record) {
            throw new Error(`e-Way Bill ${ewbNumber} not found in Truxify records.`);
        }

        const nowMs = Date.now();
        const expiryMs = new Date(record.valid_upto).getTime();
        const hoursToExpiry = (expiryMs - nowMs) / (1000 * 60 * 60);

        // NIC Rule 138(10): Extensions are only accepted within 8 hours before or after expiry
        if (hoursToExpiry > NIC_EXTENSION_WINDOW_HOURS) {
            await this.supabase
                .from('eway_bills')
                .update({ status: 'AT_RISK', updated_at: new Date().toISOString() })
                .eq('id', record.id);

            return {
                extended: false,
                status: 'AT_RISK',
                message: `Delay flagged (${hoursToExpiry.toFixed(1)}h remaining). NIC extension window opens 8h prior to expiry.`,
            };
        }

        let newValidUptoIso;

        if (!this.gspClientId || !this.gspClientSecret) {
            // Rule 138: 1 additional day per 200 km remaining (minimum 1 day)
            const extraDays = Math.max(1, Math.ceil(Number(remainingDistanceKm || 100) / 200));
            newValidUptoIso = new Date(
                Math.max(nowMs, expiryMs) + extraDays * 24 * 60 * 60 * 1000
            ).toISOString();
        } else {
            const response = await fetch(`${this.gspBaseUrl}/ewayapi/EXTEND_VALIDITY`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'client-id': this.gspClientId,
                    'client-secret': this.gspClientSecret,
                    gstin: this.gstin,
                },
                body: JSON.stringify({
                    ewbNo: Number(ewbNumber),
                    vehicleNo: record.vehicle_number,
                    fromPlace: currentPlace || 'In-Transit Highway Corridor',
                    fromState: Number(currentStateCode || 27),
                    remainingDistance: Math.ceil(Number(remainingDistanceKm)),
                    transDocNo: record.order_id.slice(0, 15),
                    transDocDate: new Date(record.created_at).toLocaleDateString('en-GB'),
                    transMode: '1', // Road
                    extnRsnCode: reasonCode,
                    extnRemarks: reasonRemark,
                    fromPincode: Number(record.origin_pincode),
                    consignmentStatus: 'M', // In Movement
                    transitType: 'R', // Road
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`NIC extension API failed: ${errText}`);
            }

            const extData = await response.json();
            newValidUptoIso = new Date(extData.validUpto).toISOString();
        }

        const updatedMetadata = {
            ewbNumber: record.ewb_number,
            consignorGstin: record.consignor_gstin,
            consigneeGstin: record.consignee_gstin,
            invoiceValue: record.invoice_value,
            vehicleNumber: record.vehicle_number,
            originPincode: record.origin_pincode,
            destinationPincode: record.destination_pincode,
            validUpto: newValidUptoIso,
        };

        const anchorResult = await auditAnchorService.anchorConsignmentState(
            updatedMetadata,
            'EXTENDED'
        );

        const newHistoryEntry = {
            event: 'EXTENDED',
            timestamp: new Date().toISOString(),
            previousValidUpto: record.valid_upto,
            validUpto: newValidUptoIso,
            coordinates: { lat: currentLat, lng: currentLng },
            remainingDistanceKm,
            sha256: anchorResult.sha256Hex,
            polygonTxHash: anchorResult.txHash,
        };

        const updatedHistory = [...(record.audit_history || []), newHistoryEntry];

        const { data: updatedRecord, error: updateError } = await this.supabase
            .from('eway_bills')
            .update({
                valid_upto: newValidUptoIso,
                remaining_distance_km: remainingDistanceKm,
                extension_count: record.extension_count + 1,
                status: 'EXTENDED',
                last_known_lat: currentLat,
                last_known_lng: currentLng,
                payload_sha256: anchorResult.sha256Hex,
                polygon_tx_hash: anchorResult.txHash,
                audit_history: updatedHistory,
                updated_at: new Date().toISOString(),
            })
            .eq('id', record.id)
            .select()
            .single();

        if (updateError) {
            throw new Error(`Failed to persist extended e-Way Bill state: ${updateError.message}`);
        }

        return {
            extended: true,
            ewayBill: updatedRecord,
            anchor: anchorResult,
        };
    }
}

module.exports = new EwayBillService();