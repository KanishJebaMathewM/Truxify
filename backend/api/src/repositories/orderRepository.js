import { getRequestCache } from '../lib/requestContext.js';
import { executeWithRetry, isRetryable } from '../core/retry.js';
import { measureExecution } from '../core/performanceMetrics.js';
import { buildPagination } from '../utils/pagination.js';

export class OrderRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async _cachedQuery(key, queryFn) {
    const cache = getRequestCache();
    if (cache && cache.has(key)) {
      return cache.get(key);
    }
    const result = await queryFn();
    if (cache && !result.error && result.data) {
      cache.set(key, result);
    }
    return result;
  }

  async _retryableQuery(queryFn, operationName) {
    return executeWithRetry(async () => {
      let result;
      try {
        result = await measureExecution(`OrderRepository.${operationName}`, queryFn);
      } catch (err) {
        if (isRetryable(err)) {
          throw err;
        }
        return { data: null, error: { message: err.message, code: err.code, status: err.status || 500 } };
      }

      if (result?.error && isRetryable(result.error)) {
        const wrapped = new Error(result.error.message || 'Supabase error');
        wrapped.code = result.error.code;
        wrapped.status = result.error.status ?? result.error.code;
        wrapped.details = result.error.details;
        throw wrapped;
      }

      return result;
    }, { operation: operationName });
  }

  // ===================================================================
  // ORDERS
  // ===================================================================

  async createOrder(data) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .insert(data)
      .select('id, order_display_id, status, created_at')
      .single(), 'createOrder');
  }

  async findOrderById(id, columns = '*') {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns)
      .eq('id', id)
      .maybeSingle(), 'findOrderById');
  }

  async findOrderByDisplayId(displayId, columns = '*') {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns)
      .eq('order_display_id', displayId)
      .maybeSingle(), 'findOrderByDisplayId');
  }
  
  async findOrderByAnyId(id, columns = '*') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(id)) {
      const result = await this.findOrderById(id, columns);
      if (result.data) return result;
    }
    return this.findOrderByDisplayId(id, columns);
  }

  async findOrdersByCustomer(customerId, columns, statuses, orderColumn, ascending, pagination) {
    return this._retryableQuery(() => {
      let query = this.supabase
        .from('orders')
        .select(columns)
        .eq('customer_id', customerId)
        .in('status', statuses)
        .order(orderColumn || 'pickup_date', { ascending: ascending ?? false });
      if (pagination) {
        const { from, to } = buildPagination(pagination);
        query = query.range(from, to);
      }
      return query;
    }, 'findOrdersByCustomer');
  }

  async findOrdersWithCount(customerId, columns, pagination) {
    const { page = 1, limit: perPage = 10 } = pagination || {};
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns, { count: 'exact' })
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(from, to), 'findOrdersWithCount');
  }

  async findOrderForTimeline(id) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select('customer_id, driver_id, order_display_id')
      .eq('id', id)
      .maybeSingle(), 'findOrderForTimeline');
  } 
  async findOrderById(id, columns = '*') {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns)
      .eq('id', id)
      .maybeSingle(), 'findOrderById');
  }

  async findOrderByDisplayId(displayId, columns = '*') {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns)
      .eq('order_display_id', displayId)
      .maybeSingle(), 'findOrderByDisplayId');
  }

  async updateOrder(id, updates) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single(), 'updateOrder');
  }

  async updateOrderWithFilter(id, updates, filters, selectColumns) {
    return this._retryableQuery(() => {
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
    }, 'updateOrderWithFilter');
  }

  async updateOrderSelective(id, updates, selectColumns) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select(selectColumns)
      .single(), 'updateOrderSelective');
  }

  async updateOrderGuardStatus(orderId, updates, notStatuses) {
    return this._retryableQuery(() => {
      let query = this.supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId);
      for (const status of notStatuses) {
        query = query.not('status', 'eq', status);
      }
      return query.select('id, order_display_id, status').single();
    }, 'updateOrderGuardStatus');
  }

  async findOrderAfterUpdate(orderId, columns) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select(columns)
      .eq('id', orderId)
      .maybeSingle(), 'findOrderAfterUpdate');
  }

  async deleteOrder(id) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .delete()
      .eq('id', id), 'deleteOrder');
  }

  // ===================================================================
  // TIMELINE
  // ===================================================================

  async createTimeline(entries) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .insert(entries), 'createTimeline');
  }

  async getTimeline(orderDisplayId) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .select('milestone, milestone_time, completed, sort_order')
      .eq('order_display_id', orderDisplayId)
      .order('sort_order', { ascending: true }), 'getTimeline');
  }

  async getTimelineWithSortCheck(orderDisplayId) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .select('milestone, sort_order, completed')
      .eq('order_display_id', orderDisplayId)
      .order('sort_order', { ascending: true }), 'getTimelineWithSortCheck');
  }

  async updateTimelineMilestone(orderDisplayId, milestone, updates) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .update(updates)
      .eq('order_display_id', orderDisplayId)
      .eq('milestone', milestone), 'updateTimelineMilestone');
  }

  async deleteTimeline(orderDisplayId) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .delete()
      .eq('order_display_id', orderDisplayId), 'deleteTimeline');
  }

  async insertTimelineEntry(entry) {
    return this._retryableQuery(() => this.supabase
      .from('order_timeline')
      .insert(entry), 'insertTimelineEntry');
  }

  // ===================================================================
  // LOAD OFFERS
  // ===================================================================

  async createLoadOffer(data) {
    return this._retryableQuery(() => this.supabase
      .from('load_offers')
      .insert(data), 'createLoadOffer');
  }

  async findLoadOfferById(id, columns = '*') {
    return this._retryableQuery(() => this.supabase
      .from('load_offers')
      .select(columns)
      .eq('id', id)
      .maybeSingle(), 'findLoadOfferById');
  }

  async findLoadOfferByOrderDisplayId(displayId) {
    return this._retryableQuery(() => this.supabase
      .from('load_offers')
      .select('id')
      .eq('order_display_id', displayId)
      .maybeSingle(), 'findLoadOfferByOrderDisplayId');
  }

  async findLoadOffers(filters, options = {}) {
    return this._retryableQuery(() => {
      let query = this.supabase.from('load_offers').select('*', options.count ? { count: 'exact' } : undefined);
      if (filters) {
        for (const [col, val] of Object.entries(filters)) {
          query = query.eq(col, val);
        }
      }
      query = query.order('created_at', { ascending: false });
      if (options.pagination) {
        const { from, to } = buildPagination(options.pagination);
        query = query.range(from, to);
      }
      return query;
    }, 'findLoadOffers');
  }

  async updateLoadOffer(orderDisplayId, updates) {
    return this._retryableQuery(() => this.supabase
      .from('load_offers')
      .update(updates)
      .eq('order_display_id', orderDisplayId), 'updateLoadOffer');
  }

  async deleteLoadOffer(orderDisplayId) {
    return this._retryableQuery(() => this.supabase
      .from('load_offers')
      .delete()
      .eq('order_display_id', orderDisplayId), 'deleteLoadOffer');
  }

  // ===================================================================
  // BIDS
  // ===================================================================

  async createBid(data) {
    return this._retryableQuery(() => this.supabase
      .from('load_bids')
      .insert(data)
      .select('*')
      .single(), 'createBid');
  }

  async findBidById(id) {
    return this._retryableQuery(() => this.supabase
      .from('load_bids')
      .select('*')
      .eq('id', id)
      .maybeSingle(), 'findBidById');
  }

  async findBidsByLoad(loadId, status, options = {}) {
    return this._retryableQuery(() => {
      let query = this.supabase
        .from('load_bids')
        .select('*', options.count ? { count: 'exact' } : undefined)
        .eq('load_id', loadId);
      if (status) {
        query = query.eq('status', status);
      }
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? true });
      }
      if (options.pagination) {
        const { from, to } = buildPagination(options.pagination);
        query = query.range(from, to);
      }
      return query;
    }, 'findBidsByLoad');
  }

  async findExistingBid(loadId, driverId, status) {
    return this._retryableQuery(() => {
      let query = this.supabase
        .from('load_bids')
        .select('id')
        .eq('load_id', loadId)
        .eq('driver_id', driverId);
      if (status) {
        query = query.eq('status', status);
      }
      return query.maybeSingle();
    }, 'findExistingBid');
  }

  // ===================================================================
  // RATINGS
  // ===================================================================

  async findRatingByOrder(orderDisplayId, customerId) {
    return this._retryableQuery(() => this.supabase
      .from('ratings')
      .select('id')
      .eq('order_display_id', orderDisplayId)
      .eq('customer_id', customerId)
      .maybeSingle(), 'findRatingByOrder');
  }

  // ===================================================================
  // RPC
  // ===================================================================

  async executeRpc(name, params, client) {
    const supabaseClient = client || this.supabase;
    return this._retryableQuery(() => supabaseClient.rpc(name, params), `executeRpc:${name}`);
  }

  // ===================================================================
  // PROFILES (read-only lookups for order context)
  // ===================================================================

  async findProfilesByIds(ids, columns = 'id, full_name') {
    return this._retryableQuery(() => this.supabase
      .from('profiles')
      .select(columns)
      .in('id', ids), 'findProfilesByIds');
  }

  async findProfile(userId, columns = 'full_name, phone, avatar_url') {
    return this._retryableQuery(() => this.supabase
      .from('profiles')
      .select(columns)
      .eq('id', userId)
      .maybeSingle(), 'findProfile');
  }

  async findCustomerWallet(userId) {
    return this._retryableQuery(() => this.supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle(), 'findCustomerWallet');
  }

  async findProfileWallet(userId) {
    return this._retryableQuery(() => this.supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle(), 'findProfileWallet');
  }

  // ===================================================================
  // DRIVER DETAILS (read-only lookups for order context)
  // ===================================================================

  async findDriverDetail(userId, columns = 'polygon_wallet_address, rating, truck_id, total_trips') {
    return this._retryableQuery(() => this.supabase
      .from('driver_details')
      .select(columns)
      .eq('user_id', userId)
      .maybeSingle(), 'findDriverDetail');
  }

  async findDriverDetails(userIds) {
    return this._retryableQuery(() => this.supabase
      .from('driver_details')
      .select('user_id, rating, total_trips, completion_rate, truck_id')
      .in('user_id', userIds), 'findDriverDetails');
  }

  async findDriverDetailMinimal(userId) {
    return this._retryableQuery(() => this.supabase
      .from('driver_details')
      .select('truck_id')
      .eq('user_id', userId)
      .maybeSingle(), 'findDriverDetailMinimal');
  }

  async findDriverWallet(userId) {
    return this._retryableQuery(() => this.supabase
      .from('driver_details')
      .select('polygon_wallet_address')
      .eq('user_id', userId)
      .maybeSingle(), 'findDriverWallet');
  }

  async findDriverDetailWithRating(userId) {
    return this._retryableQuery(() => this.supabase
      .from('driver_details')
      .select('rating, truck_id')
      .eq('user_id', userId)
      .maybeSingle(), 'findDriverDetailWithRating');
  }

  // ===================================================================
  // TRUCKS (read-only lookups for order context)
  // ===================================================================

  async findTruckById(id, columns = 'id') {
    return this._retryableQuery(() => this.supabase
      .from('trucks')
      .select(columns)
      .eq('id', id)
      .maybeSingle(), 'findTruckById');
  }

  async findTruckWithDetails(id) {
    return this._retryableQuery(() => this.supabase
      .from('trucks')
      .select('id, name, number_plate')
      .eq('id', id)
      .maybeSingle(), 'findTruckWithDetails');
  }

  async findTrucksByIds(ids) {
    return this._retryableQuery(() => this.supabase
      .from('trucks')
      .select('id, name, number_plate')
      .in('id', ids), 'findTrucksByIds');
  }

  // ===================================================================
  // DELIVERY OTPS
  // ===================================================================

  async findVerifiedDeliveryOtp(orderId) {
    return this._retryableQuery(() => this.supabase
      .from('delivery_otps')
      .select('id')
      .eq('order_id', orderId)
      .eq('verified', true)
      .limit(1)
      .maybeSingle(), 'findVerifiedDeliveryOtp');
  }

  // ===================================================================
  // WALLET TRANSACTIONS
  // ===================================================================

  async updateWalletTransaction(driverId, orderDisplayId, updates) {
    return this._retryableQuery(() => this.supabase
      .from('wallet_transactions')
      .update(updates)
      .eq('driver_id', driverId)
      .eq('order_display_id', orderDisplayId)
      .eq('txn_type', 'credit')
      .order('created_at', { ascending: false })
      .limit(1), 'updateWalletTransaction');
  }

  // ===================================================================
  // ESCROW
  // ===================================================================

  async updateEscrowBooking(orderId, bookingId, escrowStatus) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .update({
        escrow_booking_id: bookingId,
        escrow_status: escrowStatus,
      })
      .eq('id', orderId), 'updateEscrowBooking');
  }

  async revertEscrowStatus(orderId) {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .update({
        escrow_status: 'pending',
        escrow_booking_id: null,
      })
      .eq('id', orderId), 'revertEscrowStatus');
  }

  // ===================================================================
  // REPUTATION FAILURES
  // ===================================================================

  async insertReputationFailure(data) {
    return this._retryableQuery(() => this.supabase
      .from('reputation_failures')
      .insert(data), 'insertReputationFailure');
  }

  // ===================================================================
  // ESCROW REFUND RECONCILIATION
  // ===================================================================

  async findPendingEscrowRefunds() {
    return this._retryableQuery(() => this.supabase
      .from('orders')
      .select('id, order_display_id, refund_tx_hash, escrow_status, escrow_refund_retry_count')
      .in('escrow_status', ['refund_pending', 'refund_failed'])
      .limit(50), 'findPendingEscrowRefunds');
  }

  async claimRefundReconciliation(orderId, instanceId, client) {
    const supabaseClient = client || this.supabase;
    return this._retryableQuery(() => supabaseClient
      .rpc('claim_refund_reconciliation', {
        p_order_id: orderId,
        p_instance_id: instanceId,
      }), 'claimRefundReconciliation');
  }
}

