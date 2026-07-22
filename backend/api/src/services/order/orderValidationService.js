import { DomainError } from './domainError.js';
import { policy } from '../../security/policyEngine.js';

export class OrderValidationService {
  constructor({ supabase, logger }) {
    this.supabase = supabase;
    this.logger = logger;
  }

  async findOrderByIdOrDisplayId(identifier, select = '*') {
    const { data: byId, error: errId } = await this.supabase.from('orders').select(select).eq('id', identifier).maybeSingle();
    if (errId) throw new DomainError(500, { error: 'Query failed.', details: errId.message });
    if (byId) return byId;
    const { data: byDisplay, error: errDisplay } = await this.supabase.from('orders').select(select).eq('order_display_id', identifier).maybeSingle();
    if (errDisplay) throw new DomainError(500, { error: 'Query failed.', details: errDisplay.message });
    return byDisplay || null;
  }

  assertOrderFound(order) {
    if (!order) {
      throw new DomainError(404, { error: 'Order not found.' });
    }
  }

  assertCustomerOwnership(order, userId) {
    try {
      policy.authorize({ id: userId, role: 'customer' }, 'order:view-bids', { order });
    } catch (err) {
      throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
    }
  }

  assertDriverAssignment(order, driverId) {
    try {
      policy.authorize({ id: driverId, role: 'driver' }, 'milestone:update', { order });
    } catch (err) {
      throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });
    }
  }

  assertOrderAccess(order, user) {
    try {
      policy.authorize(user, 'order:view', { order });
    } catch (err) {
      throw new DomainError(403, { error: 'Access Denied: You do not own or are not assigned to this order.' });
    }
  }

  assertOrderStatus(order, allowedStatuses, errorMsg) {
    if (!allowedStatuses.includes(order.status)) {
      throw new DomainError(409, { error: errorMsg || `Order status '${order.status}' does not allow this operation.` });
    }
  }

  assertNotTerminalStatus(order) {
    if (['delivered', 'cancelled', 'payment_released'].includes(order.status)) {
      throw new DomainError(409, { error: 'Order was already cancelled, delivered, or payment released. Cannot cancel.' });
    }
  }

  assertEscrowState(order, allowedStates, errorMsg) {
    if (!allowedStates.includes(order.escrow_status)) {
      throw new DomainError(400, { error: errorMsg || `Escrow status '${order.escrow_status}' does not allow this operation.` });
    }
  }

  async assertLoadOfferAvailable(loadOfferId) {
    const { data: offer, error } = await this.supabase.from('load_offers').select('id, status, customer_id').eq('id', loadOfferId).maybeSingle();
    if (error || !offer) {
      throw new DomainError(404, { error: 'Load offer not found.' });
    }
    if (offer.status !== 'available') {
      throw new DomainError(410, { error: 'Load is no longer available for bidding.' });
    }
    return offer;
  }

  assertNotOwnLoad(offerCustomerId, userId) {
    const offer = { customer_id: offerCustomerId };
    try {
      policy.authorize({ id: userId, role: 'driver' }, 'bid:submit', { offer });
    } catch (err) {
      if (err.code === 'OWN_LOAD_VIOLATION' || err.message?.includes('own load')) {
        throw new DomainError(403, { error: 'You cannot bid on your own load offer' });
      }
      this.logger.error({ err, userId, offerCustomerId }, 'Policy authorization failed in assertNotOwnLoad');
      throw new DomainError(500, { error: 'Authorization check failed. Please try again.' });
    }
  }

  async assertTruckAssigned(driverId) {
    const { data: driverDetails } = await this.supabase.from('driver_details').select('truck_id').eq('user_id', driverId).maybeSingle();
    if (!driverDetails?.truck_id) {
      throw new DomainError(400, { error: 'You must assign a valid truck to your profile before bidding on loads' });
    }

    const { data: truck } = await this.supabase.from('trucks').select('id').eq('id', driverDetails.truck_id).maybeSingle();
    if (!truck) {
      throw new DomainError(400, { error: 'Assigned truck record could not be found' });
    }

    return { driverDetails, truck };
  }

  async assertNoDuplicateBid(loadId, driverId) {
    const { data: existingBid } = await this.supabase.from('load_bids').select('id').eq('load_id', loadId).eq('driver_id', driverId).eq('status', 'pending').maybeSingle();
    if (existingBid) {
      throw new DomainError(409, { error: 'You already have a pending bid for this load.' });
    }
  }

  async assertNoDuplicateRating(orderDisplayId, customerId) {
    const { data: existingRating } = await this.supabase.from('ratings').select('id').eq('order_display_id', orderDisplayId).eq('customer_id', customerId).maybeSingle();
    if (existingRating) {
      throw new DomainError(409, { error: 'A rating has already been submitted for this order.' });
    }
  }

  assertRatingDeliverable(order) {
    if (!['delivered', 'payment_released'].includes(order.status)) {
      throw new DomainError(400, { error: 'Order must be delivered before a rating can be submitted.' });
    }
    if (!order.driver_id) {
      throw new DomainError(400, { error: 'Order does not have an assigned driver.' });
    }
  }

  async assertDeliveryNotVerified(orderId) {
    const { data: otpCheck } = await this.supabase.from('delivery_otps').select('id').eq('order_id', orderId).eq('verified', true).limit(1).maybeSingle();
    if (otpCheck) {
      throw new DomainError(409, { error: 'Cannot cancel: delivery OTP has already been verified.' });
    }
  }

  assertMilestoneInTimeline(timeline, milestone) {
    const entry = timeline.find(t => t.milestone === milestone);
    if (!entry) {
      throw new DomainError(400, { error: `Milestone "${milestone}" is not part of this order's timeline.` });
    }
    return entry;
  }

  assertMilestoneNotDuplicate(entry) {
    if (entry.completed) {
      throw new DomainError(409, { error: `Milestone "${entry.milestone}" has already been completed.` });
    }
  }

  assertMilestoneSequence(timeline, milestone, lastCompletedSortOrder) {
    const entry = timeline.find(t => t.milestone === milestone);
    const nextExpected = timeline.find(t => !t.completed && t.sort_order > lastCompletedSortOrder);
    if (!nextExpected || nextExpected.sort_order !== entry.sort_order) {
      throw new DomainError(422, {
        error: `Milestone out of sequence. Expected "${nextExpected ? nextExpected.milestone : 'none'}" before "${milestone}".`,
      });
    }
  }

  assertChangeDropAllowed(order) {
    if (order.escrow_status === 'funded' || order.status !== 'pending') {
      const reason = order.escrow_status === 'funded'
        ? 'after escrow has been funded'
        : `after order status is '${order.status}'`;
      throw new DomainError(409, {
        error: `Drop location cannot be changed ${reason}.`,
        recovery: 'Cancel this order to receive a refund, then rebook with the correct destination.',
      });
    }
  }

  assertHasWeight(order) {
    if (order.weight_tonnes == null) {
      throw new DomainError(500, { error: 'Data inconsistency: Order is missing weight_tonnes.' });
    }
  }

  async assertHosCompliant(driverId) {
    const { data: driver, error } = await this.supabase
      .from('driver_details')
      .select('accumulated_driving_minutes, accumulated_on_duty_minutes, hos_status')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (error) {
      throw new DomainError(500, { error: 'Failed to verify driver HoS status.', details: error.message });
    }

    if (driver) {
      const drivingHours = (driver.accumulated_driving_minutes || 0) / 60;
      const onDutyHours = (driver.accumulated_on_duty_minutes || 0) / 60;

      if (drivingHours >= 11 || onDutyHours >= 14) {
        throw new DomainError(403, { 
          error: 'HoS Limit Exceeded: You have reached your maximum legal driving or on-duty hours for this shift. You must take a mandatory rest break before bidding on new loads.'
        });
      }
    }
  }
}
