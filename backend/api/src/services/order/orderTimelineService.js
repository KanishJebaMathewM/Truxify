export class OrderTimelineService {
  constructor(orderRepository) {
    this.orderRepository = orderRepository;
  }

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
}
