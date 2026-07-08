export class OrderRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ===================================================================
  // ORDERS
  // ===================================================================

  async createOrder(data) {
    return this.supabase
      .from('orders')
      .insert(data)
      .select('id, order_display_id, status, created_at')
      .single();
  }

  async findOrderById(id, columns = '*') {
    return this.supabase
      .from('orders')
      .select(columns)
      .eq('id', id)
      .maybeSingle();
  }

  async findOrderByDisplayId(displayId, columns = '*') {
    return this.supabase
      .from('orders')
      .select(columns)
      .eq('order_display_id', displayId)
      .maybeSingle();
  }

  async findOrderByAnyId(id, columns = '*') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(id)) {
      const result = await this.findOrderById(id, columns);
      if (result.data) return result;
    }
    return this.findOrderByDisplayId(id, columns);
  }

  async findOrdersByCustomer(customerId, columns, statuses, orderColumn, ascending) {
    return this.supabase
      .from('orders')
      .select(columns)
      .eq('customer_id', customerId)
      .in('status', statuses)
      .order(orderColumn || 'pickup_date', { ascending: ascending ?? false });
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

  async findOrderForTimeline(id) {
    return this.supabase
      .from('orders')
      .select('customer_id, driver_id, order_display_id')
      .eq('id', id)
      .maybeSingle();
  }

  async findOrderByDisplayForTimeline(displayId) {
    return this.supabase
      .from('orders')
      .select('customer_id, driver_id, order_display_id')
      .eq('order_display_id', displayId)
      .maybeSingle();
  }

  async updateOrder(id, updates) {
    return this.supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
  }

  async updateOrderWithFilter(id, updates, filters, selectColumns) {
    let query = this.supabase.from('orders').update(updates).eq('id', id);
    if (filters) {
      for (const f of filters) {
        if (f.op === 'eq') {
          query = query.eq(f.column, f.value);
        } else if (f.op === 'not') {
          query = query.not(f.column, f.operator, f.value);
        } else if (f.op === 'in') {
          query = query.in(f.column, f.value);
        }
      }
    }
    return query.select(selectColumns || 'cancellation_fee, order_display_id, status, cancellation_reason, escrow_status').single();
  }

  async updateOrderSelective(id, updates, selectColumns) {
    return this.supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select(selectColumns)
      .single();
  }

  async updateOrderGuardStatus(orderId, updates, notStatuses) {
    let query = this.supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId);
    for (const status of notStatuses) {
      query = query.not('status', 'eq', status);
    }
    return query.select('id, order_display_id, status').single();
  }

  async findOrderAfterUpdate(orderId, columns) {
    return this.supabase
      .from('orders')
      .select(columns)
      .eq('id', orderId)
      .maybeSingle();
  }

  async deleteOrder(id) {
    return this.supabase
      .from('orders')
      .delete()
      .eq('id', id);
  }

  // ===================================================================
  // TIMELINE
  // ===================================================================

  async createTimeline(entries) {
    return this.supabase
      .from('order_timeline')
      .insert(entries);
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
    return this.supabase
      .from('order_timeline')
      .update(updates)
      .eq('order_display_id', orderDisplayId)
      .eq('milestone', milestone);
  }

  async deleteTimeline(orderDisplayId) {
    return this.supabase
      .from('order_timeline')
      .delete()
      .eq('order_display_id', orderDisplayId);
  }

  async insertTimelineEntry(entry) {
    return this.supabase
      .from('order_timeline')
      .insert(entry);
  }

  // ===================================================================
  // LOAD OFFERS
  // ===================================================================

  async createLoadOffer(data) {
    return this.supabase
      .from('load_offers')
      .insert(data);
  }

  async findLoadOfferById(id, columns = '*') {
    return this.supabase
      .from('load_offers')
      .select(columns)
      .eq('id', id)
      .maybeSingle();
  }

  async findLoadOfferByOrderDisplayId(displayId) {
    return this.supabase
      .from('load_offers')
      .select('id')
      .eq('order_display_id', displayId)
      .maybeSingle();
  }

  async findLoadOffers(filters, options) {
    let query = this.supabase.from('load_offers').select('*');
    if (filters) {
      for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
      }
    }
    return query.order('created_at', { ascending: false });
  }

  async updateLoadOffer(orderDisplayId, updates) {
    return this.supabase
      .from('load_offers')
      .update(updates)
      .eq('order_display_id', orderDisplayId);
  }

  async deleteLoadOffer(orderDisplayId) {
    return this.supabase
      .from('load_offers')
      .delete()
      .eq('order_display_id', orderDisplayId);
  }

  // ===================================================================
  // BIDS
  // ===================================================================

  async createBid(data) {
    return this.supabase
      .from('load_bids')
      .insert(data)
      .select('*')
      .single();
  }

  async findBidById(id) {
    return this.supabase
      .from('load_bids')
      .select('*')
      .eq('id', id)
      .maybeSingle();
  }

  async findBidsByLoad(loadId, status, options) {
    let query = this.supabase
      .from('load_bids')
      .select('*')
      .eq('load_id', loadId);
    if (status) {
      query = query.eq('status', status);
    }
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }
    return query;
  }

  async findExistingBid(loadId, driverId, status) {
    let query = this.supabase
      .from('load_bids')
      .select('id')
      .eq('load_id', loadId)
      .eq('driver_id', driverId);
    if (status) {
      query = query.eq('status', status);
    }
    return query.maybeSingle();
  }

  // ===================================================================
  // RATINGS
  // ===================================================================

  async findRatingByOrder(orderDisplayId, customerId) {
    return this.supabase
      .from('ratings')
      .select('id')
      .eq('order_display_id', orderDisplayId)
      .eq('customer_id', customerId)
      .maybeSingle();
  }

  // ===================================================================
  // RPC
  // ===================================================================

  async executeRpc(name, params) {
    return this.supabase.rpc(name, params);
  }

  // ===================================================================
  // PROFILES (read-only lookups for order context)
  // ===================================================================

  async findProfilesByIds(ids, columns = 'id, full_name') {
    return this.supabase
      .from('profiles')
      .select(columns)
      .in('id', ids);
  }

  async findProfile(userId, columns = 'full_name, phone, avatar_url') {
    return this.supabase
      .from('profiles')
      .select(columns)
      .eq('id', userId)
      .maybeSingle();
  }

  async findCustomerWallet(userId) {
    return this.supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();
  }

  async findProfileWallet(userId) {
    return this.supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();
  }

  // ===================================================================
  // DRIVER DETAILS (read-only lookups for order context)
  // ===================================================================

  async findDriverDetail(userId, columns = 'polygon_wallet_address, rating, truck_id, total_trips') {
    return this.supabase
      .from('driver_details')
      .select(columns)
      .eq('user_id', userId)
      .maybeSingle();
  }

  async findDriverDetails(userIds) {
    return this.supabase
      .from('driver_details')
      .select('user_id, rating, total_trips, completion_rate, truck_id')
      .in('user_id', userIds);
  }

  async findDriverDetailMinimal(userId) {
    return this.supabase
      .from('driver_details')
      .select('truck_id')
      .eq('user_id', userId)
      .maybeSingle();
  }

  async findDriverWallet(userId) {
    return this.supabase
      .from('driver_details')
      .select('polygon_wallet_address')
      .eq('user_id', userId)
      .maybeSingle();
  }

  async findDriverDetailWithRating(userId) {
    return this.supabase
      .from('driver_details')
      .select('rating, truck_id')
      .eq('user_id', userId)
      .maybeSingle();
  }

  // ===================================================================
  // TRUCKS (read-only lookups for order context)
  // ===================================================================

  async findTruckById(id, columns = 'id') {
    return this.supabase
      .from('trucks')
      .select(columns)
      .eq('id', id)
      .maybeSingle();
  }

  async findTruckWithDetails(id) {
    return this.supabase
      .from('trucks')
      .select('id, name, number_plate')
      .eq('id', id)
      .maybeSingle();
  }

  async findTrucksByIds(ids) {
    return this.supabase
      .from('trucks')
      .select('id, name, number_plate')
      .in('id', ids);
  }

  // ===================================================================
  // DELIVERY OTPS
  // ===================================================================

  async findVerifiedDeliveryOtp(orderId) {
    return this.supabase
      .from('delivery_otps')
      .select('id')
      .eq('order_id', orderId)
      .eq('verified', true)
      .limit(1)
      .maybeSingle();
  }

  // ===================================================================
  // WALLET TRANSACTIONS
  // ===================================================================

  async updateWalletTransaction(driverId, orderDisplayId, updates) {
    return this.supabase
      .from('wallet_transactions')
      .update(updates)
      .eq('driver_id', driverId)
      .eq('order_display_id', orderDisplayId)
      .eq('txn_type', 'credit');
  }

  // ===================================================================
  // ESCROW
  // ===================================================================

  async updateEscrowBooking(orderId, bookingId, escrowStatus) {
    return this.supabase
      .from('orders')
      .update({
        escrow_booking_id: bookingId,
        escrow_status: escrowStatus,
      })
      .eq('id', orderId);
  }

  async revertEscrowStatus(orderId) {
    return this.supabase
      .from('orders')
      .update({
        escrow_status: 'pending',
        escrow_booking_id: null,
      })
      .eq('id', orderId);
  }

  // ===================================================================
  // REPUTATION FAILURES
  // ===================================================================

  async insertReputationFailure(data) {
    return this.supabase
      .from('reputation_failures')
      .insert(data);
  }

  // ===================================================================
  // ESCROW REFUND RECONCILIATION
  // ===================================================================

  async findPendingEscrowRefunds() {
    return this.supabase
      .from('orders')
      .select('id, order_display_id, refund_tx_hash, escrow_status, escrow_refund_retry_count')
      .in('escrow_status', ['refund_pending', 'refund_failed'])
      .limit(50);
  }

  async claimRefundReconciliation(orderId, instanceId) {
    return this.supabase
      .rpc('claim_refund_reconciliation', {
        p_order_id: orderId,
        p_instance_id: instanceId,
      });
  }
}
