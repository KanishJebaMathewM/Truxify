const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const ewayBillService = require('../services/ewayBillService');

const MIN_FALLBACK_SPEED_KMPH = 28; // Conservative highway speed when truck is stalled/in traffic
const SAFETY_BUFFER_MINUTES = 45;

class EwayExpiryWatcher {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        this.task = null;
    }

    /**
     * Computes Haversine road-adjusted distance (1.22x straight-line factor) in km.
     */
    estimateRoadDistanceKm(lat1, lng1, lat2, lng2) {
        const toRad = (deg) => (deg * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c * 1.22;
    }

    /**
     * Ingests live GPS ping from the driver WebSocket telemetry stream and evaluates expiry risk.
     */
    async processTelemetryPing({ orderId, lat, lng, speedKmph, destLat, destLng }) {
        const { data: ewb, error } = await this.supabase
            .from('eway_bills')
            .select('*')
            .eq('order_id', orderId)
            .in('status', ['VERIFIED', 'AT_RISK', 'EXTENDED'])
            .maybeSingle();

        if (error || !ewb) return null;

        const remainingDistanceKm =
            destLat && destLng
                ? this.estimateRoadDistanceKm(lat, lng, destLat, destLng)
                : Number(ewb.remaining_distance_km);

        // Use rolling/effective speed; fall back if truck is stuck in traffic or breakdown
        const effectiveSpeed =
            speedKmph && speedKmph > 10 ? Number(speedKmph) : MIN_FALLBACK_SPEED_KMPH;

        const estimatedHoursRemaining = remainingDistanceKm / effectiveSpeed;
        const predictedArrivalMs =
            Date.now() +
            estimatedHoursRemaining * 60 * 60 * 1000 +
            SAFETY_BUFFER_MINUTES * 60 * 1000;

        const validUptoMs = new Date(ewb.valid_upto).getTime();

        await this.supabase
            .from('eway_bills')
            .update({
                last_known_lat: lat,
                last_known_lng: lng,
                remaining_distance_km: Number(remainingDistanceKm.toFixed(2)),
                last_telemetry_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', ewb.id);

        // Trigger predictive extension if predicted arrival exceeds e-Way Bill expiry
        if (predictedArrivalMs > validUptoMs) {
            return ewayBillService.extendEwayBillValidity({
                ewbNumber: ewb.ewb_number,
                currentLat: lat,
                currentLng: lng,
                remainingDistanceKm: Number(remainingDistanceKm.toFixed(2)),
                reasonRemark: `Predictive auto-extension: ETA exceeds validity at ${effectiveSpeed.toFixed(
                    1
                )} km/h`,
            });
        }

        return { extended: false, status: ewb.status };
    }

    /**
     * Periodic sweep every 10 minutes to catch AT_RISK bills entering the 8-hour NIC extension window
     * or vehicles in cellular dead zones.
     */
    async runSweep() {
        const lookaheadHorizon = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

        const { data: expiringBills, error } = await this.supabase
            .from('eway_bills')
            .select('*')
            .in('status', ['VERIFIED', 'AT_RISK', 'EXTENDED'])
            .lte('valid_upto', lookaheadHorizon);

        if (error || !expiringBills?.length) return;

        for (const bill of expiringBills) {
            const remainingKm = Number(bill.remaining_distance_km || 0);
            if (remainingKm <= 5) continue; // Already at destination

            const estimatedHoursNeeded = remainingKm / MIN_FALLBACK_SPEED_KMPH;
            const predictedArrivalMs = Date.now() + estimatedHoursNeeded * 3600 * 1000;
            const validUptoMs = new Date(bill.valid_upto).getTime();

            if (predictedArrivalMs > validUptoMs) {
                try {
                    await ewayBillService.extendEwayBillValidity({
                        ewbNumber: bill.ewb_number,
                        currentLat: bill.last_known_lat,
                        currentLng: bill.last_known_lng,
                        remainingDistanceKm: remainingKm,
                        reasonRemark: 'Scheduled predictive sweep auto-extension before expiry',
                    });
                } catch (err) {
                    console.error(`[EwayExpiryWatcher] Failed extending ${bill.ewb_number}:`, err.message);
                }
            }
        }
    }

    start() {
        if (this.task) return;
        this.task = cron.schedule('*/10 * * * *', () => {
            this.runSweep().catch((err) =>
                console.error('[EwayExpiryWatcher] Sweep error:', err.message)
            );
        });
    }

    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
    }
}

module.exports = new EwayExpiryWatcher();