import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

class EventRepository {
  async saveEvent(event) {
    try {
      const { data, error } = await supabase
        .from('events')
        .insert([{
          event_id: event.eventId,
          event_type: event.eventType,
          order_id: event.orderId,
          data: event.data,
          metadata: event.metadata,
          timestamp: event.metadata.timestamp,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to save event:', error);
      throw error;
    }
  }

  async getEventsByOrderId(orderId, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('order_id', orderId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get events:', error);
      throw error;
    }
  }

  async getEventsByType(eventType, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('event_type', eventType)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get events by type:', error);
      throw error;
    }
  }

  async getEventById(eventId) {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get event:', error);
      throw error;
    }
  }

  async replayEvents(orderId) {
    try {
      const events = await this.getEventsByOrderId(orderId);
      
      // Replay events in order
      for (const event of events.reverse()) {
        // Emit event again
        await this.reemitEvent(event);
      }
      
      return events;
    } catch (error) {
      logger.error('Failed to replay events:', error);
      throw error;
    }
  }

  async reemitEvent(event) {
    // Re-emit event to Kafka
    const kafka = (await import('../config/kafka.config.js')).default;
    await kafka.publishEvent(
      event.event_type,
      {
        eventId: event.event_id,
        eventType: event.event_type,
        orderId: event.order_id,
        data: event.data,
        metadata: {
          ...event.metadata,
          isReplay: true,
        },
      },
      event.order_id
    );
  }

  async getSnapshot(orderId) {
    try {
      const events = await this.getEventsByOrderId(orderId);
      
      // Build current state from events
      const snapshot = {
        orderId,
        status: 'created',
        data: {},
        timeline: [],
      };
      
      for (const event of events.reverse()) {
        snapshot.timeline.push({
          eventId: event.event_id,
          type: event.event_type,
          timestamp: event.timestamp,
          data: event.data,
        });
        
        // Update state based on event
        switch (event.event_type) {
          case 'ORDER_CREATED':
            snapshot.status = 'created';
            snapshot.data = { ...snapshot.data, ...event.data };
            break;
          case 'DRIVER_ASSIGNED':
            snapshot.status = 'assigned';
            snapshot.data.driver = event.data;
            break;
          case 'PAYMENT_CONFIRMED':
            snapshot.status = 'paid';
            snapshot.data.payment = event.data;
            break;
          case 'TRIP_STARTED':
            snapshot.status = 'in_transit';
            snapshot.data.trip = event.data;
            break;
          case 'TRIP_COMPLETED':
            snapshot.status = 'completed';
            snapshot.data.completion = event.data;
            break;
          case 'ESCROW_RELEASED':
            snapshot.status = 'settled';
            snapshot.data.escrow = event.data;
            break;
        }
      }
      
      return snapshot;
    } catch (error) {
      logger.error('Failed to get snapshot:', error);
      return null;
    }
  }

  async getEventStats() {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('event_type, count')
        .groupBy('event_type');

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get event stats:', error);
      return [];
    }
  }
}

export default new EventRepository();
