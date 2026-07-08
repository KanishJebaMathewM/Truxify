export class OrderRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ── Orders ────────────────────────────────────────────────────────

  async createOrder(data) {
    return this.supabase.from('orders').insert(data).select('id, order_display_id, status, created_at').single();
  }

  async findOrderById(id, columns = '*') {
    return this.supabase.from('orders').select(columns).eq('id', id).maybeSingle();
  }

  async findOrderByDisplayId(displayId, columns = '*') {
    return this.supabase.from('orders').select(columns).eq('order_display_id', displayId).maybeSingle();
  }

  async findOrderByAnyId(id, columns = '*') {
    const result = await this.findOrderById(id, columns);
    if (result.data) return result;
    if (result.error) return result;
    return this.findOrderByDisplayId(id, columns);
  }

  async findOrdersByCustomer(customerId, columns, statuses, orderColumn, ascending) {
    let query = this.supabase.from('orders').select(columns).eq('customer_id', customerId);
    if (statuses) query = query.in('status', statuses);
    return query.order(orderColumn || 'pickup_date', { ascending: ascending ?? false });
  }

  async findOrdersWithCount(customerId, columns, pagination) {
    const { page = 1, limit: perPage = 10 } = pagination || {};
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    return this.supabase
      .from('orders')
      .select(columns, { count: 'exact' })
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(from, to);
  }

  async updateOrder(id, updates) {
    return this.supabase.from('orders').update(updates).eq('id', id).select('*').single();
  }

  async updateOrderWithFilter(id, updates, filters, selectColumns) {
    let query = this.supabase.from('orders').update(updates).eq('id', id);
    if (filters) {
      for (const f of filters) {
        if (f.op === 'eq') query = query.eq(f.column, f.value);
        else if (f.op === 'not') query = query.not(f.column, f.operator, f.value);
        else if (f.op === 'in') query = query.in(f.column, f.value);
      }
    }
    return query.select(selectColumns || 'id').single();
  }

  async updateOrderGuardStatus(id, updates, notStatuses) {
    let query = this.supabase.from('orders').update(updates).eq('id', id);
    for (const status of notStatuses) {
      query = query.not('status', 'eq', status);
    }
    return query.select('*').single();
  }

  async deleteOrder(id) {
    return this.supabase.from('orders').delete().eq('id', id);
  }

  // ── Timeline ──────────────────────────────────────────────────────

  async createTimeline(entries) {
    return this.supabase.from('order_timeline').insert(entries);
  }

  async getTimeline(orderDisplayId) {
    return this.supabase
      .from('order_timeline')
      .select('milestone, milestone_time, completed, sort_order')
      .eq('order_display_id', orderDisplayId)
      .order('sort_order', { ascending: true });
  }

  async getTimelineWithSortCheck(orderDisplayId) {
    return this.supabase
      .from('order_timeline')
      .select('milestone, sort_order, completed')
      .eq('order_display_id', orderDisplayId)
      .order('sort_order', { ascending: true });
  }

  async updateTimelineMilestone(orderDisplayId, milestone, updates) {
    let query = this.supabase.from('order_timeline').update(updates).eq('order_display_id', orderDisplayId).eq('milestone', milestone);
    return query;
  }

  async deleteTimeline(orderDisplayId) {
    return this.supabase.from('order_timeline').delete().eq('order_display_id', orderDisplayId);
  }

  // ── Load Offers ───────────────────────────────────────────────────

  async createLoadOffer(data) {
    return this.supabase.from('load_offers').insert(data);
  }

  async findLoadOfferById(id, columns = '*') {
    return this.supabase.from('load_offers').select(columns).eq('id', id).maybeSingle();
  }

  async findLoadOfferByOrderDisplayId(displayId) {
    return this.supabase.from('load_offers').select('id').eq('order_display_id', displayId).maybeSingle();
  }

  async findLoadOffers(isEnRoute) {
    return this.supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', isEnRoute)
      .order('created_at', { ascending: false });
  }

  async updateLoadOffer(orderDisplayId, updates) {
    return this.supabase.from('load_offers').update(updates).eq('order_display_id', orderDisplayId);
  }

  async deleteLoadOffer(orderDisplayId) {
    return this.supabase.from('load_offers').delete().eq('order_display_id', orderDisplayId);
  }

  // ── Bids ──────────────────────────────────────────────────────────

  async createBid(data) {
    return this.supabase.from('load_bids').insert(data).select('*').single();
  }

  async findBidById(id) {
    return this.supabase.from('load_bids').select('*').eq('id', id).maybeSingle();
  }

  async findBidsByLoad(loadId, status, options) {
    let query = this.supabase.from('load_bids').select('*').eq('load_id', loadId);
    if (status) query = query.eq('status', status);
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }
    return query;
  }

  async findExistingBid(loadId, driverId, status) {
    let query = this.supabase.from('load_bids').select('id').eq('load_id', loadId).eq('driver_id', driverId);
    if (status) query = query.eq('status', status);
    return query.maybeSingle();
  }

  // ── Ratings ───────────────────────────────────────────────────────

  async findRatingByOrder(orderDisplayId, customerId) {
    return this.supabase.from('ratings').select('id').eq('order_display_id', orderDisplayId).eq('customer_id', customerId).maybeSingle();
  }

  async executeRpc(name, params) {
    return this.supabase.rpc(name, params);
  }

  // ── Profiles (read-only) ──────────────────────────────────────────

  async findProfilesByIds(ids, columns = 'id, full_name') {
    return this.supabase.from('profiles').select(columns).in('id', ids);
  }

  async findProfile(userId, columns = 'full_name, phone, avatar_url') {
    return this.supabase.from('profiles').select(columns).eq('id', userId).maybeSingle();
  }

  async findCustomerWallet(userId) {
    return this.supabase.from('profiles').select('polygon_wallet_address').eq('id', userId).maybeSingle();
  }

  async findProfileWallet(userId) {
    return this.supabase.from('profiles').select('polygon_wallet_address').eq('id', userId).maybeSingle();
  }

  // ── Driver Details (read-only) ────────────────────────────────────

  async findDriverDetail(userId, columns = 'polygon_wallet_address, rating, truck_id, total_trips') {
    return this.supabase.from('driver_details').select(columns).eq('user_id', userId).maybeSingle();
  }

  async findDriverDetails(userIds) {
    return this.supabase.from('driver_details').select('user_id, rating, total_trips, completion_rate, truck_id').in('user_id', userIds);
  }

  async findDriverDetailMinimal(userId) {
    return this.supabase.from('driver_details').select('truck_id').eq('user_id', userId).maybeSingle();
  }

  async findDriverWallet(userId) {
    return this.supabase.from('driver_details').select('polygon_wallet_address').eq('user_id', userId).maybeSingle();
  }

  async findDriverDetailWithRating(userId) {
    return this.supabase.from('driver_details').select('rating, truck_id').eq('user_id', userId).maybeSingle();
  }

  // ── Trucks (read-only) ────────────────────────────────────────────

  async findTruckById(id, columns = 'id') {
    return this.supabase.from('trucks').select(columns).eq('id', id).maybeSingle();
  }

  async findTruckWithDetails(id) {
    return this.supabase.from('trucks').select('id, name, number_plate').eq('id', id).maybeSingle();
  }

  async findTrucksByIds(ids) {
    return this.supabase.from('trucks').select('id, name, number_plate').in('id', ids);
  }

  // ── Delivery OTPs ─────────────────────────────────────────────────

  async findVerifiedDeliveryOtp(orderId) {
    return this.supabase.from('delivery_otps').select('id').eq('order_id', orderId).eq('verified', true).limit(1).maybeSingle();
  }

  // ── Wallet Transactions ───────────────────────────────────────────

  async updateWalletTransaction(driverId, orderDisplayId, updates) {
    return this.supabase.from('wallet_transactions').update(updates).eq('driver_id', driverId).eq('order_display_id', orderDisplayId).eq('txn_type', 'credit');
  }

  // ── Escrow ────────────────────────────────────────────────────────

  async updateEscrowBooking(orderId, bookingId, escrowStatus) {
    return this.supabase.from('orders').update({ escrow_booking_id: bookingId, escrow_status: escrowStatus }).eq('id', orderId);
  }

  async revertEscrowStatus(orderId) {
    return this.supabase.from('orders').update({ escrow_status: 'pending', escrow_booking_id: null }).eq('id', orderId);
  }

  // ── Reputation Failures ──────────────────────────────────────────

  async insertReputationFailure(data) {
    return this.supabase.from('reputation_failures').insert(data);
  }
}
