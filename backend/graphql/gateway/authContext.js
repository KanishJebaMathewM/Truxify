// Role/identity resolution for the GraphQL gateway (issue #6333).
//
// The caller's role must come from the server-authoritative `profiles` table,
// never from the client-editable `user_metadata.role`. Supabase allows clients
// to self-assign `user_metadata` via auth.updateUser({ data: ... }), so trusting
// it here would let a customer fabricate `x-user-role: admin` for every subgraph.
//
// This module is intentionally dependency-free (the client is injected) so it
// can be unit-tested without wiring up the Apollo gateway or a real DB client.

import DataLoader from 'dataloader';
// backend/graphql/gateway/authContext.js

import supabaseAdmin from '../config/supabase.js';
import logger from '../middleware/logger.js';

const DEFAULT_ROLE = 'CUSTOMER';

/**
 * Resolves user context from Supabase Bearer token for GraphQL gateway.
 * Fixed per issue #8977 to query profiles by firebase_uid instead of profiles.id.
 */
export async function resolveUserContext(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { role: DEFAULT_ROLE, userId: null, isAuthenticated: false };
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      logger.warn('Failed to authenticate token in GraphQL gateway', { error: authError?.message });
      return { role: DEFAULT_ROLE, userId: null, isAuthenticated: false };
    }

    // FIX: Query profiles table by firebase_uid instead of internal profiles.id
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, firebase_uid')
      .eq('firebase_uid', user.id)
      .maybeSingle();

    if (profileError) {
      logger.error('Database error while fetching profile role in gateway', { error: profileError.message });
    }

    const role = profile?.role || DEFAULT_ROLE;
    const userId = profile?.id || user.id;

    logger.info('Resolved GraphQL user context successfully', { userId, role });

    return {
      role,
      userId,
      isAuthenticated: true,
      token
    };
  } catch (err) {
    logger.error('Exception in resolveUserContext', { error: err.message, stack: err.stack });
    return { role: DEFAULT_ROLE, userId: null, isAuthenticated: false };
  }
}
export function createLoaders(supabaseClient) {
  return {
    paymentLoader: new DataLoader(async (orderIds) => {
      const { data, error } = await supabaseClient
        .from('payments')
        .select('*')
        .in('order_id', orderIds);
      
      if (error) return orderIds.map(() => null);
      
      const paymentMap = new Map();
      data.forEach(payment => {
        paymentMap.set(payment.order_id, payment);
      });
      
      return orderIds.map(id => paymentMap.get(id) || null);
    }),
    tripLoader: new DataLoader(async (orderIds) => {
      const { data, error } = await supabaseClient
        .from('trips')
        .select('*')
        .in('order_id', orderIds);
      
      if (error) return orderIds.map(() => null);
      
      const tripMap = new Map();
      data.forEach(trip => {
        tripMap.set(trip.order_id, trip);
      });
      
      return orderIds.map(id => tripMap.get(id) || null);
    })
  };
}

export const DEFAULT_ROLE = 'CUSTOMER';

export async function resolveUserContext(supabaseClient, token) {
  if (!token) return null;

  const stripped = token.startsWith('Bearer ') ? token.slice(7) : token;
  const { data: { user }, error } = await supabaseClient.auth.getUser(stripped);
  if (error || !user) return null;

  // profiles.role is column-privilege protected (authenticated users can never
  // UPDATE it) and RLS only returns the caller's own row. Fall back to the
  // least-privilege DEFAULT_ROLE when no profile row resolves.
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return { id: user.id, role: profile?.role || DEFAULT_ROLE };
}
