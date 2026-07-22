import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import eventRepository from '../repositories/event.repository.js';

class OrderReadModel {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
    this.maxLimit = 100;
    this.maxOffset = 10000;
  }

  parsePaginationValue(value, { field, min, max }) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new Error(`${field} must be an integer`);
    }
    const text = String(value);
    if (!/^\d+$/.test(text)) {
      throw new Error(`${field} must be an integer`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < min) {
      throw new Error(`${field} must be at least ${min}`);
    }
    return Math.min(parsed, max);
  }

  async buildReadModel(orderId) {
    try {
      // Get snapshot from events
      const snapshot = await eventRepository.getSnapshot(orderId);
      
      if (snapshot) {
        // Update read model in database
        await this.updateReadModel(orderId, snapshot);
        return snapshot;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to build read model:', error);
      throw error;
    }
  }

  async updateReadModel(orderId, snapshot) {
    try {
      // Upsert read model
      const { data, error } = await supabase
        .from('order_read_models')
        .upsert([{
          order_id: orderId,
          status: snapshot.status,
          data: snapshot.data,
          timeline: snapshot.timeline,
          updated_at: new Date().toISOString(),
        }], {
          onConflict: 'order_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) throw error;
      
      // Update cache
      this.cache.set(orderId, {
        data: data,
        timestamp: Date.now(),
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to update read model:', error);
      throw error;
    }
  }

  async getOrderReadModel(orderId) {
    // Check cache
    if (this.cache.has(orderId)) {
      const cached = this.cache.get(orderId);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      } else {
        this.cache.delete(orderId);
      }
    }
    
    try {
      // Get from database
      const { data, error } = await supabase
        .from('order_read_models')
        .select('*')
        .eq('order_id', orderId)
        .single();

      if (error) {
        // If not found, build from events
        return await this.buildReadModel(orderId);
      }
      
      // Cache it
      this.cache.set(orderId, {
        data: data,
        timestamp: Date.now(),
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to get read model:', error);
      return null;
    }
  }

  async getAllOrdersReadModel(filters = {}) {
    try {
      let query = supabase
        .from('order_read_models')
        .select('*');
      
      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.customerId) {
        query = query.eq('data->customer_id', filters.customerId);
      }
      if (filters.driverId) {
        query = query.eq('data->driver_id', filters.driverId);
      }
      if (filters.fromDate) {
        query = query.gte('updated_at', filters.fromDate);
      }
      if (filters.toDate) {
        query = query.lte('updated_at', filters.toDate);
      }
      
      query = query.order('updated_at', { ascending: false });
      
      const limit = this.parsePaginationValue(filters.limit, {
        field: 'limit',
        min: 1,
        max: this.maxLimit,
      });
      const offset = this.parsePaginationValue(filters.offset, {
        field: 'offset',
        min: 0,
        max: this.maxOffset,
      });

      if (limit !== null) {
        query = query.limit(limit);
      }
      if (offset !== null) {
        query = query.offset(offset);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get all read models:', error);
      return [];
    }
  }

  async getOrderStats() {
    const statuses = ['pending', 'accepted', 'in_transit', 'delivered', 'cancelled', 'payment_released'];
    const stats = {};

    for (const status of statuses) {
      const { count, error } = await supabase
        .from('order_read_models')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

      if (error) throw error;
      stats[status] = count ?? 0;
    }

    return stats;
  }

  async clearCache() {
    this.cache.clear();
    logger.info('Read model cache cleared');
  }
}

export default new OrderReadModel();
