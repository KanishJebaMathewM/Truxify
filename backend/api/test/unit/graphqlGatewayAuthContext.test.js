import { describe, it, expect } from 'vitest';
import {
  resolveUserContext,
  DEFAULT_ROLE,
} from '../../../../backend/graphql/gateway/authContext.js';

function makeClient({ user = null, getUserError = null, profile = null, profileError = null } = {}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user },
        error: getUserError,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: profile,
            error: profileError,
          }),
        }),
      }),
    }),
  };
}

describe('GraphQL gateway role resolution (issue #6333)', () => {
  it('resolves the role from profiles, ignoring a self-set user_metadata.role', async () => {
    // Attacker: token whose user_metadata.role claims "admin", while the
    // server-side profiles row says "customer".
    const client = makeClient({
      user: { id: 'user-1', user_metadata: { role: 'admin' } },
      profile: { role: 'customer' },
    });

    const ctx = await resolveUserContext(client, 'Bearer attacker-token');

    expect(ctx).toEqual({ id: 'user-1', role: 'customer' });
  });

  it('falls back to the least-privilege DEFAULT_ROLE when no profile row resolves', async () => {
    const client = makeClient({
      user: { id: 'user-2', user_metadata: { role: 'admin' } },
      profile: null,
    });

    const ctx = await resolveUserContext(client, 'Bearer token');

    expect(ctx).toEqual({ id: 'user-2', role: DEFAULT_ROLE });
  });

  it('returns null when the token cannot be verified', async () => {
    const client = makeClient({ user: null, getUserError: { message: 'invalid' } });

    expect(await resolveUserContext(client, 'Bearer bogus')).toBeNull();
  });

  it('returns null when no token is supplied', async () => {
    const client = makeClient();
    expect(await resolveUserContext(client, '')).toBeNull();
    expect(await resolveUserContext(client, undefined)).toBeNull();
  });

  it('strips a "Bearer " prefix before calling getUser', async () => {
    let receivedToken = null;
    const client = {
      auth: {
        getUser: async (token) => {
          receivedToken = token;
          return { data: { user: { id: 'user-3' } }, error: null };
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: 'driver' }, error: null }),
          }),
        }),
      }),
    };

    const ctx = await resolveUserContext(client, 'Bearer raw-token');

    expect(receivedToken).toBe('raw-token');
    expect(ctx).toEqual({ id: 'user-3', role: 'driver' });
  });
});
