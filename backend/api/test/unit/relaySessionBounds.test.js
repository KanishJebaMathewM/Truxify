import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelayBooking } from '../../src/controllers/relayController.js';
import {
  COMPLETED_RELAY_SESSION_RETENTION_MS,
  MAX_ACTIVE_RELAY_SESSIONS,
  STALE_RELAY_SESSION_TTL_MS,
  advanceRelayLeg,
  createRelaySession,
  getRelaySession,
  pruneRelaySessions,
} from '../../src/services/relayDispatchService.js';

const DELHI = { lat: 28.6139, lng: 77.209, address: 'Delhi' };
const AGRA = { lat: 27.1767, lng: 78.0081, address: 'Agra' };
const MUMBAI = { lat: 19.076, lng: 72.8777, address: 'Mumbai' };

function clearRegistry() {
  pruneRelaySessions(Number.MAX_SAFE_INTEGER);
}

describe('relay session registry bounds', () => {
  beforeEach(clearRegistry);
  afterEach(clearRegistry);

  it('creates, retrieves, and advances a relay session', async () => {
    const session = await createRelaySession('customer-1', {
      origin: DELHI,
      destination: MUMBAI,
      totalAmount: 50000,
    });

    expect(session.status).toBe('ACTIVE');
    expect(session.totalLegs).toBeGreaterThan(1);
    await expect(getRelaySession(session.relayBookingId)).resolves.toBe(session);

    for (let legIndex = 0; legIndex < session.totalLegs; legIndex += 1) {
      const updated = await advanceRelayLeg(session.relayBookingId, legIndex, { verified: true });
      expect(updated.legs[legIndex].status).toBe('COMPLETED');
    }

    expect(session.status).toBe('COMPLETED');
    await expect(getRelaySession(session.relayBookingId)).resolves.toBe(session);
  });

  it('removes a completed session after the retention window', async () => {
    const session = await createRelaySession('customer-2', {
      origin: DELHI,
      destination: MUMBAI,
      totalAmount: 25000,
    });

    for (let legIndex = 0; legIndex < session.totalLegs; legIndex += 1) {
      await advanceRelayLeg(session.relayBookingId, legIndex, { verified: true });
    }

    session.completedAt = new Date(Date.now() - COMPLETED_RELAY_SESSION_RETENTION_MS - 1000).toISOString();
    expect(pruneRelaySessions()).toBe(1);
    await expect(getRelaySession(session.relayBookingId)).rejects.toMatchObject({ status: 404 });
  });

  it('removes an active session that has been idle past the stale TTL', async () => {
    const session = await createRelaySession('customer-3', {
      origin: DELHI,
      destination: AGRA,
      totalAmount: 10000,
    });

    session.updatedAt = new Date(Date.now() - STALE_RELAY_SESSION_TTL_MS - 1000).toISOString();
    expect(pruneRelaySessions()).toBe(1);
    await expect(getRelaySession(session.relayBookingId)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects creation at the cap and accepts a replacement after pruning', async () => {
    let firstSession = null;
    for (let index = 0; index < MAX_ACTIVE_RELAY_SESSIONS; index += 1) {
      const session = await createRelaySession('cap-customer', {
        origin: DELHI,
        destination: AGRA,
        totalAmount: 1000,
      });
      firstSession ??= session;
    }

    await expect(
      createRelaySession('cap-customer', {
        origin: DELHI,
        destination: AGRA,
        totalAmount: 1000,
      })
    ).rejects.toMatchObject({ status: 429 });

    firstSession.status = 'COMPLETED';
    firstSession.completedAt = new Date(
      Date.now() - COMPLETED_RELAY_SESSION_RETENTION_MS - 1000
    ).toISOString();
    firstSession.updatedAt = firstSession.completedAt;
    expect(pruneRelaySessions()).toBe(1);

    const replacement = await createRelaySession('cap-customer', {
      origin: DELHI,
      destination: AGRA,
      totalAmount: 1000,
    });
    await expect(getRelaySession(replacement.relayBookingId)).resolves.toBe(replacement);
  });

  it('maps capacity failures to 429 in the create controller', async () => {
    for (let index = 0; index < MAX_ACTIVE_RELAY_SESSIONS; index += 1) {
      await createRelaySession('cap-customer', {
        origin: DELHI,
        destination: AGRA,
        totalAmount: 1000,
      });
    }

    const req = {
      user: { id: 'cap-customer' },
      body: { origin: DELHI, destination: AGRA, totalAmount: 1000 },
    };
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    const next = vi.fn();

    await createRelayBooking(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error).toMatch(/capacity reached/i);
    expect(next).not.toHaveBeenCalled();
  });
});
