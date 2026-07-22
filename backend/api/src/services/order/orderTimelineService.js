import { DomainError } from './domainError.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import logger from '../../middleware/logger.js';

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
  constructor(orderRepository) {
    this.orderRepository = orderRepository;
  }

  async createOrderTimeline(orderDisplayId) {
    const milestones = DEFAULT_MILESTONES.map(m => ({
      order_display_id: orderDisplayId,
      milestone: m.milestone,
      milestone_time: m.completed ? new Date().toISOString() : null,
      completed: m.completed,
      sort_order: m.sort_order,
    }));

    const { error } = await this.orderRepository.createTimeline(milestones);
    if (error) {
      throw new DomainError(500, { error: 'Failed to create order timeline.', details: error.message });
    }
  }

  async getOrderTimeline(orderDisplayId) {
    const { data, error } = await this.orderRepository.getTimeline(orderDisplayId);
    if (error) {
      throw new DomainError(500, { error: 'Failed to fetch order timeline.', details: error.message });
    }
    return data || [];
  }

  async completeMilestone(orderDisplayId, milestone, milestoneTime) {
    const time = milestoneTime || new Date().toISOString();
    const { error } = await this.orderRepository.updateTimelineMilestone(orderDisplayId, milestone, { completed: true, milestone_time: time });
    if (error) {
      throw new DomainError(500, { error: 'Failed to update order timeline.', details: error.message });
    }
  }

  async resetMilestone(orderDisplayId, milestone) {
    const { error } = await this.orderRepository.updateTimelineMilestone(orderDisplayId, milestone, { completed: false, milestone_time: null });
    if (error) {
      logger.error('Timeline Reset Error:', error.message);
      throw new DomainError(500, { error: 'Failed to reset order timeline.', details: error.message });
    }
  }

  async insertDropChangedEvent(orderDisplayId) {
    const { error } = await this.orderRepository.createTimeline([{
      order_display_id: orderDisplayId,
      milestone: 'Drop Changed',
      milestone_time: new Date().toISOString(),
      completed: true,
      sort_order: 25,
    }]);
    if (error) {
      logger.error('Failed to update timeline for change-drop:', error.message);
      throw new DomainError(500, { error: 'Failed to record drop-change event.', details: error.message });
    }
  }

  async completeOrderPlacedMilestone(orderDisplayId, completedAt) {
    const time = completedAt || new Date().toISOString();
    const { error } = await this.orderRepository.updateTimelineMilestone(orderDisplayId, 'Order Placed', { completed: true, milestone_time: time });
    if (error) {
      // Silently fail — cancel continues even if timeline update fails
      logger.error('Failed to update Order Placed milestone on cancel:', error.message);
      throw new DomainError(500, { error: 'Failed to update Order Placed milestone.', details: error.message });
    }
  }

  async deleteOrderTimeline(orderDisplayId) {
    const { error } = await this.orderRepository.deleteTimeline(orderDisplayId);
    if (error) {
      // Silently fail — cleanup is best-effort
      logger.error('Failed to delete order timeline:', error.message);
      throw new DomainError(500, { error: 'Failed to delete order timeline.', details: error.message });
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
    return this.orderRepository.createTimeline(milestones);
  }

  async getTimeline(orderDisplayId) {
    const { data, error } = await this.orderRepository.getTimeline(orderDisplayId);
    return { data: data || [], error };
  }

  async getTimelineWithSortCheck(orderDisplayId) {
    return this.orderRepository.getTimelineWithSortCheck(orderDisplayId);
  }

  async markMilestoneCompleted(orderDisplayId, milestone) {
    const { error } = await this.orderRepository.updateTimelineMilestone(
      orderDisplayId, milestone,
      { completed: true, milestone_time: new Date().toISOString() }
    );
    return { error };
  }

  async rollbackMilestone(orderDisplayId, milestone) {
    const { error } = await this.orderRepository.updateTimelineMilestone(
      orderDisplayId, milestone,
      { completed: false, milestone_time: null }
    );
    return { error };
  }

  async insertEntry(orderDisplayId, milestone, sortOrder) {
    return this.orderRepository.createTimeline([{
      order_display_id: orderDisplayId,
      milestone,
      milestone_time: new Date().toISOString(),
      completed: true,
      sort_order: sortOrder,
    }]);
  }

  async deleteTimeline(orderDisplayId) {
    return this.orderRepository.deleteTimeline(orderDisplayId);
  }

  async insertCancelEvent(orderDisplayId) {
    return this.insertEntry(orderDisplayId, 'Cancelled', 70);
  }
}
