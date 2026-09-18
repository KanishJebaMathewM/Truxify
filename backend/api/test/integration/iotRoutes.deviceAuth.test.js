import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { supabaseAdmin } from '../../src/config/db.js';
import jwt from 'jsonwebtoken';

describe('IoT Routes Device Authentication (#10502)', () => {
    let deviceToken;
    let customerToken;
    let testDeviceId; // This is the profiles.id for the iot_device
    let testLoadId;
    const deviceProfileId = 'device-profile-uuid-123';
    const customerId = 'customer-uuid-456';

    beforeAll(async () => {
        // Generate tokens
        deviceToken = jwt.sign(
            { id: deviceProfileId, role: 'iot_device', sub: deviceProfileId },
            process.env.JWT_SECRET || 'test-secret'
        );
        customerToken = jwt.sign(
            { id: customerId, role: 'customer', sub: customerId },
            process.env.JWT_SECRET || 'test-secret'
        );

        // Seed a device profile
        const { data: device } = await supabaseAdmin
            .from('profiles')
            .insert({
                id: deviceProfileId,
                role: 'iot_device',
                full_name: 'Cold Chain Sensor 01',
                is_active: true
            })
            .select('id')
            .single();
        testDeviceId = device.id;

        // Seed a load offer that is mapped to this device
        const { data: load } = await supabaseAdmin
            .from('load_offers')
            .insert({
                customer_id: customerId,
                device_id: testDeviceId, // THE CRITICAL MAPPING COLUMN
                origin: 'Warehouse A',
                destination: 'Warehouse B',
                status: 'in_transit',
                required_temp_min: 2,
                required_temp_max: 8
            })
            .select('id')
            .single();
        testLoadId = load.id;
    });

    afterAll(async () => {
        await supabaseAdmin.from('load_offers').delete().eq('id', testLoadId);
        await supabaseAdmin.from('profiles').delete().eq('id', testDeviceId);
        await supabaseAdmin.from('iot_telemetry').delete().eq('load_id', testLoadId);
    });

    describe('POST /api/iot/telemetry/:id (Device Ingestion)', () => {
        it('should allow iot_device to POST telemetry for its assigned load', async () => {
            const res = await request(app)
                .post(`/api/iot/telemetry/${testLoadId}`)
                .set('Authorization', `Bearer ${deviceToken}`)
                .send({
                    temperature: 4.5,
                    humidity: 60,
                    timestamp: new Date().toISOString()
                });

            // Before fix: 403 (req.user.id === loadId was false)
            // After fix: 201 or 200
            expect([200, 201]).toContain(res.status);
        });

        it('should reject iot_device trying to POST to an unassigned load', async () => {
            // Create another load not assigned to this device
            const { data: otherLoad } = await supabaseAdmin
                .from('load_offers')
                .insert({ customer_id: customerId, device_id: 'other-device-id', status: 'in_transit' })
                .select('id')
                .single();

            const res = await request(app)
                .post(`/api/iot/telemetry/${otherLoad.id}`)
                .set('Authorization', `Bearer ${deviceToken}`)
                .send({ temperature: 5.0, humidity: 50 });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Access denied');

            await supabaseAdmin.from('load_offers').delete().eq('id', otherLoad.id);
        });

        it('should trigger cold-chain alert if temperature is out of range', async () => {
            const res = await request(app)
                .post(`/api/iot/telemetry/${testLoadId}`)
                .set('Authorization', `Bearer ${deviceToken}`)
                .send({
                    temperature: 15.0, // Out of 2-8 range
                    humidity: 60,
                    timestamp: new Date().toISOString()
                });

            expect([200, 201]).toContain(res.status);

            // Verify alert was created
            const { data: alerts } = await supabaseAdmin
                .from('cold_chain_alerts')
                .select('*')
                .eq('load_id', testLoadId)
                .order('created_at', { ascending: false })
                .limit(1);

            expect(alerts.length).toBeGreaterThan(0);
            expect(alerts[0].alert_type).toBe('temperature_breach');
        });
    });

    describe('GET /api/iot/telemetry/:id (Device History Read)', () => {
        beforeEach(async () => {
            // Seed some telemetry data
            await supabaseAdmin.from('iot_telemetry').insert([
                { load_id: testLoadId, device_id: testDeviceId, temperature: 4.0, created_at: new Date().toISOString() },
                { load_id: testLoadId, device_id: testDeviceId, temperature: 4.2, created_at: new Date().toISOString() }
            ]);
        });

        it('should allow iot_device to GET its own telemetry history', async () => {
            const res = await request(app)
                .get(`/api/iot/telemetry/${testLoadId}`)
                .set('Authorization', `Bearer ${deviceToken}`);

            // Before fix: 403 (no iot_device branch in GET)
            // After fix: 200
            expect(res.status).toBe(200);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.length).toBeGreaterThanOrEqual(2);
        });

        it('should allow customer to GET telemetry for their load', async () => {
            const res = await request(app)
                .get(`/api/iot/telemetry/${testLoadId}`)
                .set('Authorization', `Bearer ${customerToken}`);

            expect(res.status).toBe(200);
        });

        it('should reject iot_device trying to GET telemetry for unassigned load', async () => {
            const { data: otherLoad } = await supabaseAdmin
                .from('load_offers')
                .insert({ customer_id: customerId, device_id: 'other-device-id', status: 'in_transit' })
                .select('id')
                .single();

            const res = await request(app)
                .get(`/api/iot/telemetry/${otherLoad.id}`)
                .set('Authorization', `Bearer ${deviceToken}`);

            expect(res.status).toBe(403);

            await supabaseAdmin.from('load_offers').delete().eq('id', otherLoad.id);
        });
    });
});
