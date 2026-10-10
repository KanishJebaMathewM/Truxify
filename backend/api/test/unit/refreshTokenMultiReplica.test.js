/**
 * Refresh-token rotation behind several API replicas.
 *
 * The API runs as 3+ pods (k8s/deployments/api-deployment.yaml) that share ONE database
 * but each keep their own in-memory token-family maps. Rotation therefore has to be
 * arbitrated by the database, not by process memory. Every test boots independent
 * "replicas" (a fresh module graph each, via vi.resetModules) over a shared fake
 * database whose statements are atomic, like single SQL statements on Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { rows: [], seq: 0, fail: null };
  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));

  class Query {
    constructor() {
      this.op = 'select';
      this.filters = [];
      this.returning = false;
      this.one = false;
    }
    select() {
      if (this.op !== 'select') this.returning = true;
      return this;
    }
    insert(values) {
      this.op = 'insert';
      this.values = values;
      return this;
    }
    update(values) {
      this.op = 'update';
      this.values = values;
      return this;
    }
    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }
    single() {
      this.one = true;
      return this;
    }
    then(resolve, reject) {
      return this.run().then(resolve, reject);
    }
    async run() {
      await networkDelay();
      if (state.fail && state.fail(this.op, this.filters)) {
        return { data: null, error: { message: `injected ${this.op} failure` } };
      }
      const matches = (row) => this.filters.every(([column, value]) => row[column] === value);
      if (this.op === 'insert') {
        const row = { id: ++state.seq, ...this.values };
        state.rows.push(row);
        return { data: this.one ? { ...row } : [{ ...row }], error: null };
      }
      const hit = state.rows.filter(matches);
      if (this.op === 'update') {
        hit.forEach((row) => Object.assign(row, this.values));
        return { data: this.returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      if (this.one) {
        return hit.length === 1
          ? { data: { ...hit[0] }, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: hit.map((row) => ({ ...row })), error: null };
    }
  }

  return { state, createClient: () => ({ from: () => new Query() }) };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: db.createClient }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Boots an independent replica: its own service instance and its own family maps. */
async function bootReplica() {
  vi.resetModules();
  return import('../../src/services/refreshTokenService.js');
}

const liveTokens = (userId) =>
  db.state.rows.filter((row) => row.user_id === userId && !row.is_revoked);

describe('refresh-token rotation across API replicas', () => {
  beforeEach(() => {
    db.state.rows = [];
    db.state.seq = 0;
    db.state.fail = null;
  });

  it('accepts a legitimate refresh that lands on a replica with stale family memory', async () => {
    const replicaA = await bootReplica();
    const replicaB = await bootReplica();

    const login = await replicaA.createRefreshToken('user-1', 'phone', {});
    await replicaA.createRefreshToken('user-1', 'tablet', {});

    const first = await replicaB.rotateRefreshToken(login.token, 'phone', {});
    // Replica A still remembers generation 0 for this family and now sees generation 1.
    const second = await replicaA.rotateRefreshToken(first.token, 'phone', {});

    expect(second.generation).toBe(2);
    expect(
      liveTokens('user-1')
        .map((row) => row.device_id)
        .sort()
    ).toEqual(['phone', 'tablet']);
  });

  it('keeps honest users signed in when their refreshes are spread over three replicas', async () => {
    const replicas = [await bootReplica(), await bootReplica(), await bootReplica()];
    const anyReplica = () => replicas[Math.floor(Math.random() * replicas.length)];

    for (let user = 0; user < 15; user += 1) {
      const userId = `honest-${user}`;
      let token = (await anyReplica().createRefreshToken(userId, 'phone', {})).token;
      for (let refresh = 0; refresh < 4; refresh += 1) {
        token = (await anyReplica().rotateRefreshToken(token, 'phone', {})).token;
      }
      expect(liveTokens(userId)).toHaveLength(1);
    }
  });

  it('lets exactly one concurrent rotation of the same token win and leaves no live token', async () => {
    for (let round = 0; round < 15; round += 1) {
      db.state.rows = [];
      const replicas = [await bootReplica(), await bootReplica(), await bootReplica()];
      const login = await replicas[0].createRefreshToken('user-2', 'phone', {});

      const results = await Promise.allSettled(
        replicas.map((replica) => replica.rotateRefreshToken(login.token, 'phone', {}))
      );

      const winners = results.filter((result) => result.status === 'fulfilled');
      const losers = results.filter((result) => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      for (const loser of losers) {
        expect(loser.reason.message).toMatch('Token reuse detected');
      }
      // Reuse revokes every session, including the winner's replacement.
      expect(liveTokens('user-2')).toHaveLength(0);
    }
  });

  it('treats replay of an already rotated token as theft and revokes every session', async () => {
    const replica = await bootReplica();
    const login = await replica.createRefreshToken('user-5', 'phone', {});
    await replica.createRefreshToken('user-5', 'tablet', {});

    await replica.rotateRefreshToken(login.token, 'phone', {});
    await expect(replica.rotateRefreshToken(login.token, 'attacker', {})).rejects.toThrow(
      'Token reuse detected. All sessions revoked.'
    );

    expect(liveTokens('user-5')).toHaveLength(0);
  });

  it('does not burn the current token when the replacement cannot be stored', async () => {
    const replica = await bootReplica();
    const login = await replica.createRefreshToken('user-3', 'phone', {});

    db.state.fail = (op) => op === 'insert';
    await expect(replica.rotateRefreshToken(login.token, 'phone', {})).rejects.toThrow(
      'Failed to create refresh token'
    );

    db.state.fail = null;
    const retried = await replica.rotateRefreshToken(login.token, 'phone', {});
    expect(retried.generation).toBe(1);
  });

  it('revokes the unreturned replacement when the conditional update itself fails', async () => {
    const replica = await bootReplica();
    const login = await replica.createRefreshToken('user-4', 'phone', {});

    db.state.fail = (op, filters) =>
      op === 'update' && filters.some(([column, value]) => column === 'is_revoked' && value === false);
    await expect(replica.rotateRefreshToken(login.token, 'phone', {})).rejects.toThrow(
      'Failed to revoke refresh token'
    );

    db.state.fail = null;
    expect(db.state.rows.filter((row) => row.generation === 1 && !row.is_revoked)).toHaveLength(0);
  });
});
