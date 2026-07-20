import { TOPICS } from '../config/kafka.config.js';
import kafka from '../config/kafka.config.js';
import { v4 as uuidv4 } from 'uuid';

class OrderEventService {
  constructor() {
    this.events = [];
  }

  async emitOrderCreated(orderData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ORDER_CREATED',
      orderId: orderData.orderId,
      data: orderData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'order-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ORDER_CREATED, event, orderData.orderId);
    this.events.push(event);
    return event;
  }

  async emitOrderUpdated(orderId, updates) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ORDER_UPDATED',
      orderId,
      data: updates,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'order-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ORDER_UPDATED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitOrderCancelled(orderId, reason) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ORDER_CANCELLED',
      orderId,
      data: { reason, cancelledAt: new Date().toISOString() },
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'order-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ORDER_CANCELLED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitDriverAssigned(orderId, driverData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'DRIVER_ASSIGNED',
      orderId,
      data: driverData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'order-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.DRIVER_ASSIGNED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitPaymentConfirmed(orderId, paymentData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'PAYMENT_CONFIRMED',
      orderId,
      data: paymentData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'payment-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.PAYMENT_CONFIRMED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitTripStarted(orderId, tripData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'TRIP_STARTED',
      orderId,
      data: tripData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'trip-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.TRIP_STARTED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitTripCompleted(orderId, completionData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'TRIP_COMPLETED',
      orderId,
      data: completionData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'trip-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.TRIP_COMPLETED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitEscrowCreated(orderId, escrowData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ESCROW_CREATED',
      orderId,
      data: escrowData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'escrow-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ESCROW_CREATED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitEscrowReleased(orderId, releaseData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ESCROW_RELEASED',
      orderId,
      data: releaseData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'escrow-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ESCROW_RELEASED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitETAUpdated(orderId, etaData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'ETA_UPDATED',
      orderId,
      data: etaData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'ml-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.ETA_UPDATED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitLocationUpdated(orderId, locationData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'LOCATION_UPDATED',
      orderId,
      data: locationData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'tracking-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.LOCATION_UPDATED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitFraudDetected(orderId, fraudData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'FRAUD_DETECTED',
      orderId,
      data: fraudData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'fraud-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.FRAUD_DETECTED, event, orderId);
    this.events.push(event);
    return event;
  }

  async emitNotificationSent(orderId, notificationData) {
    const event = {
      eventId: uuidv4(),
      eventType: 'NOTIFICATION_SENT',
      orderId,
      data: notificationData,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'notification-service',
      },
    };
    
    await kafka.publishEvent(TOPICS.NOTIFICATION_SENT, event, orderId);
    this.events.push(event);
    return event;
  }
}

export default new OrderEventService();