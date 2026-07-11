import { DomainError } from './domainError.js';

const DEFAULT_MILESTONES = [
  { milestone: 'Order Placed', completed: true, sort_order: 10 },
  { milestone: 'Truck Assigned', completed: false, sort_order: 20 },
  { milestone: 'En Route to Pickup', completed: false, sort_order: 30 },
  { milestone: 'Arrived at Pickup', completed: false, sort_order: 35 },
  { milestone: 'Goods Loaded', completed: false, sort_order: 40 },
  { milestone: 'In Transit', completed: false, sort_order: 50 },
  { milestone: 'Arriving', completed: false, sort_order: 55 },
  { milestone: 'Delivered', completed: false, sort_order: 60 },
];

export class OrderTimelineService {
  constructor(args) {
    if (args && args.supabase) {
      this.supabase = args.supabase;
      this.logger = args.logger;
    } else {
      this.orderRepository = args;
    }
  }

  async createOrderTimeline(orderDisplayId) {
    const milestones = DEFAULT_MILESTONES.map(m => ({
      order_display_id: orderDisplayId,
      milestone: m.milestone,
      milestone_time: m.completed ? new Date().toISOString() : null,
      completed: m.completed,
      sort_order: m.sort_order,
    }));

    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.createTimeline(milestones);
      error = res.error;
    } else {
      const res = await this.supabase.from('order_timeline').insert(milestones);
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Timeline Insertion Error:', error.message);
      throw new DomainError(500, { error: 'Failed to create order timeline.', details: error.message });
    }
  }

  async getOrderTimeline(orderDisplayId) {
    let data, error;
    if (this.orderRepository) {
      const res = await this.orderRepository.getTimeline(orderDisplayId);
      data = res.data;
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .select('milestone, milestone_time, completed, sort_order')
        .eq('order_display_id', orderDisplayId)
        .order('sort_order', { ascending: true });
      data = res.data;
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Timeline Fetch Error:', error.message);
      throw new DomainError(500, { error: 'Failed to fetch order timeline.', details: error.message });
    }

    return data || [];
  }

  async completeMilestone(orderDisplayId, milestone, milestoneTime) {
    const time = milestoneTime || new Date().toISOString();
    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.updateTimelineMilestone(orderDisplayId, milestone, { completed: true, milestone_time: time });
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .update({ completed: true, milestone_time: time })
        .eq('order_display_id', orderDisplayId)
        .eq('milestone', milestone);
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Timeline Update Error:', error.message);
      throw new DomainError(500, { error: 'Failed to update order timeline.', details: error.message });
    }
  }

  async resetMilestone(orderDisplayId, milestone) {
    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.updateTimelineMilestone(orderDisplayId, milestone, { completed: false, milestone_time: null });
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .update({ completed: false, milestone_time: null })
        .eq('order_display_id', orderDisplayId)
        .eq('milestone', milestone);
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Timeline Reset Error:', error.message);
    }
  }

  async insertDropChangedEvent(orderDisplayId) {
    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.createTimeline([{
        order_display_id: orderDisplayId,
        milestone: 'Drop Changed',
        milestone_time: new Date().toISOString(),
        completed: true,
        sort_order: 25,
      }]);
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .insert({
          order_display_id: orderDisplayId,
          milestone: 'Drop Changed',
          milestone_time: new Date().toISOString(),
          completed: true,
          sort_order: 25,
        });
      error = res.error;
    }

    if (error) {
      this.logger?.warn?.('Failed to update timeline for change-drop:', error.message);
    }
  }

  async completeOrderPlacedMilestone(orderDisplayId, completedAt) {
    const time = completedAt || new Date().toISOString();
    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.updateTimelineMilestone(orderDisplayId, 'Order Placed', { completed: true, milestone_time: time });
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .update({ completed: true, milestone_time: time })
        .eq('order_display_id', orderDisplayId)
        .eq('milestone', 'Order Placed');
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Failed to update Order Placed milestone on cancel:', error.message);
    }
  }

  async deleteOrderTimeline(orderDisplayId) {
    let error;
    if (this.orderRepository) {
      const res = await this.orderRepository.deleteTimeline(orderDisplayId);
      error = res.error;
    } else {
      const res = await this.supabase
        .from('order_timeline')
        .delete()
        .eq('order_display_id', orderDisplayId);
      error = res.error;
    }

    if (error) {
      this.logger?.error?.('Failed to delete order timeline:', error.message);
    }
  }

  // --- Repository delegation ---

  async generateDefaultTimeline(orderDisplayId) {
    const milestones = [
      { order_display_id: orderDisplayId, milestone: 'Order Placed', milestone_time: new Date().toISOString(), completed: true, sort_order: 10 },
      { order_display_id: orderDisplayId, milestone: 'Truck Assigned', milestone_time: null, completed: false, sort_order: 20 },
      { order_display_id: orderDisplayId, milestone: 'En Route to Pickup', milestone_time: null, completed: false, sort_order: 30 },
      { order_display_id: orderDisplayId, milestone: 'Arrived at Pickup', milestone_time: null, completed: false, sort_order: 35 },
      { order_display_id: orderDisplayId, milestone: 'Goods Loaded', milestone_time: null, completed: false, sort_order: 40 },
      { order_display_id: orderDisplayId, milestone: 'In Transit', milestone_time: null, completed: false, sort_order: 50 },
      { order_display_id: orderDisplayId, milestone: 'Arriving', milestone_time: null, completed: false, sort_order: 55 },
      { order_display_id: orderDisplayId, milestone: 'Delivered', milestone_time: null, completed: false, sort_order: 60 },
    ];
    if (this.orderRepository) {
      return this.orderRepository.createTimeline(milestones);
    } else {
      return this.supabase.from('order_timeline').insert(milestones);
    }
  }

  async getTimeline(orderDisplayId) {
    if (this.orderRepository) {
      const { data, error } = await this.orderRepository.getTimeline(orderDisplayId);
      return { data: data || [], error };
    } else {
      const { data, error } = await this.supabase
        .from('order_timeline')
        .select('milestone, milestone_time, completed, sort_order')
        .eq('order_display_id', orderDisplayId)
        .order('sort_order', { ascending: true });
      return { data: data || [], error };
    }
  }

  async getTimelineWithSortCheck(orderDisplayId) {
    if (this.orderRepository) {
      return this.orderRepository.getTimelineWithSortCheck(orderDisplayId);
    } else {
      return this.supabase
        .from('order_timeline')
        .select('milestone, sort_order, completed')
        .eq('order_display_id', orderDisplayId)
        .order('sort_order', { ascending: true });
    }
  }

  async markMilestoneCompleted(orderDisplayId, milestone) {
    if (this.orderRepository) {
      const { error } = await this.orderRepository.updateTimelineMilestone(
        orderDisplayId, milestone,
        { completed: true, milestone_time: new Date().toISOString() }
      );
      return { error };
    } else {
      const { error } = await this.supabase
        .from('order_timeline')
        .update({ completed: true, milestone_time: new Date().toISOString() })
        .eq('order_display_id', orderDisplayId)
        .eq('milestone', milestone);
      return { error };
    }
  }

  async rollbackMilestone(orderDisplayId, milestone) {
    if (this.orderRepository) {
      const { error } = await this.orderRepository.updateTimelineMilestone(
        orderDisplayId, milestone,
        { completed: false, milestone_time: null }
      );
      return { error };
    } else {
      const { error } = await this.supabase
        .from('order_timeline')
        .update({ completed: false, milestone_time: null })
        .eq('order_display_id', orderDisplayId)
        .eq('milestone', milestone);
      return { error };
    }
  }

  async insertEntry(orderDisplayId, milestone, sortOrder) {
    if (this.orderRepository) {
      return this.orderRepository.createTimeline([{
        order_display_id: orderDisplayId,
        milestone,
        milestone_time: new Date().toISOString(),
        completed: true,
        sort_order: sortOrder,
      }]);
    } else {
      return this.supabase
        .from('order_timeline')
        .insert({
          order_display_id: orderDisplayId,
          milestone,
          milestone_time: new Date().toISOString(),
          completed: true,
          sort_order: sortOrder,
        });
    }
  }

  async deleteTimeline(orderDisplayId) {
    if (this.orderRepository) {
      return this.orderRepository.deleteTimeline(orderDisplayId);
    } else {
      return this.supabase
        .from('order_timeline')
        .delete()
        .eq('order_display_id', orderDisplayId);
    }
  }
}
