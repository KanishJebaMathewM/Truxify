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
