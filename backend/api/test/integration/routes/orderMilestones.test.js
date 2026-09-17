import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../../src/app.js';
import { supabaseAdmin } from '../../../src/config/db.js';
import jwt from 'jsonwebtoken';

describe('PUT /api/orders/:id/milestones (#13308)', () => {
    let driverToken;
    let customerToken;
    let testOrderId;
    let testOrderDisplayId;
    const driverId = 'driver-milestone-test-01';
    const customerId = 'cust-milestone-test-01';

    beforeAll(async () => {
        // Generate bypass tokens for testing
        driverToken = jwt.sign({ id: driverId, role: 'driver' }, process.env.JWT_SECRET || 'test');
        customerToken = jwt.sign({ id: customerId, role: 'customer' }, process.env.JWT_SECRET || 'test');

        // Seed test order
        const { data: order } = await supabaseAdmin
            .from('orders')
            .insert({
                customer_id: customerId,
                driver_id: driverId,
                status: 'en_route_pickup',
                pickup_address: 'Test Warehouse',
                drop_address: 'Test Factory'
            })
            .select('id, order_display_id')
            .single();

        testOrderId = order.id;
        testOrderDisplayId = order.order_display_id;
    });

    afterAll(async () => {
        await supabaseAdmin.from('orders').delete().eq('id', testOrderId);
    });

    beforeEach(async () => {
        // Reset status before each test
        await supabaseAdmin.from('orders').update({ status: 'en_route_pickup' }).eq('id', testOrderId);
    });

    it('should return 404 if route was previously missing (now should return 200)', async () => {
        const res = await request(app)
            .put(`/api/orders/${testOrderId}/milestones`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ milestone: 'Arrived at Pickup' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Milestone updated');
        expect(res.body.new_status).toBe('arrived_pickup');
    });

    it('should reject invalid milestone names with 400', async () => {
        const res = await request(app)
            .put(`/api/orders/${testOrderId}/milestones`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ milestone: 'Teleported to Destination' });

        expect(res.status).toBe(400);
    });

    it('should reject unauthorized users (customer) with 403', async () => {
        const res = await request(app)
            .put(`/api/orders/${testOrderId}/milestones`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ milestone: 'Arrived at Pickup' });

        // Depending on policy engine, might be 403 or 401
        expect([401, 403]).toContain(res.status);
    });

    it('should reject unauthenticated requests with 401', async () => {
        const res = await request(app)
            .put(`/api/orders/${testOrderId}/milestones`)
            .send({ milestone: 'Arrived at Pickup' });

        expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent order ID', async () => {
        const fakeUUID = '00000000-0000-0000-0000-000000000000';
        const res = await request(app)
            .put(`/api/orders/${fakeUUID}/milestones`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ milestone: 'Arrived at Pickup' });

        expect(res.status).toBe(404);
    });
});
