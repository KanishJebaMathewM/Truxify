import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELIVERY_DELAY_THRESHOLD_MINUTES,
  DeliveryDelayService,
  evaluateDeliveryDelay,
} from '../../src/services/order/deliveryDelayService.js';

const baseOrder = {
  id: 'order-1',
  order_display_id: 'ORD-15417',
  customer_id: 'customer-1',
  driver_id: 'driver-1',
  status: 'in_transit',
  drop_lat: 18.52,
  drop_lng: 73.85,
  eta: '2026-09-15T10:00:00.000Z',
  delivery_delay_state: 'normal',
};

function setup({ durationSeconds, order = baseOrder, thresholdMinutes = 15 } = {}) {
  const orderRepository = {
    findOrderById: vi.fn().mockResolvedValue({ data: { ...order }, error: null }),
    updateDeliveryEtaState: vi.fn().mockResolvedValue({ data: { id: order.id }, error: null }),
  };
  const routeEstimate = vi.fn().mockResolvedValue({ durationSeconds });
  const notify = vi.fn().mockResolvedValue({ success: true });
  const service = new DeliveryDelayService({ orderRepository, routeEstimate, notify, thresholdMinutes });
  return { service, orderRepository, routeEstimate, notify };
}

describe('DeliveryDelayService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T09:00:00.000Z'));
  });

  it('uses the configured default threshold', () => {
    expect(DELIVERY_DELAY_THRESHOLD_MINUTES).toBe(15);
    expect(evaluateDeliveryDelay({
      previousEta: '2026-09-15T10:00:00.000Z',
      currentEta: '2026-09-15T10:14:00.000Z',
    }).state).toBe('recovered');
  });

  it('honors a service-specific threshold configuration', async () => {
    const { service, notify } = setup({
      durationSeconds: 60 * 11,
      thresholdMinutes: 10,
      order: { ...baseOrder, eta: '2026-09-15T09:00:00.000Z' },
    });

    await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify for an ETA change below the threshold', async () => {
    const { service, notify } = setup({ durationSeconds: 60 * 74 });

    const result = await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(result.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies once when a delay crosses the threshold', async () => {
    const { service, notify, orderRepository } = setup({ durationSeconds: 60 * 76 });

    const result = await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(result.state).toBe('delayed');
    expect(notify).toHaveBeenCalledWith(
      'customer-1',
      'Delivery delay update',
      expect.stringContaining('Order ORD-15417'),
      'trip_update',
      expect.objectContaining({ order_display_id: 'ORD-15417', updated_eta: expect.any(String), delay_minutes: 16 })
    );
    expect(orderRepository.updateDeliveryEtaState).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated significant delays', async () => {
    const order = { ...baseOrder, eta: '2026-09-15T10:20:00.000Z', previous_eta: '2026-09-15T10:00:00.000Z', delivery_delay_state: 'delayed' };
    const { service, notify } = setup({ durationSeconds: 60 * 80, order });

    await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(notify).not.toHaveBeenCalled();
  });

  it('sends one recovery notification after a significant delay improves', async () => {
    const order = { ...baseOrder, eta: '2026-09-15T10:20:00.000Z', previous_eta: '2026-09-15T10:00:00.000Z', delivery_delay_state: 'delayed' };
    const { service, notify } = setup({ durationSeconds: 60 * 60, order });

    const result = await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(result.state).toBe('normal');
    expect(notify).toHaveBeenCalledWith(
      'customer-1',
      'Delivery ETA improved',
      expect.stringContaining('improved'),
      'trip_update',
      expect.objectContaining({ update_type: 'recovery' })
    );
  });

  it('does not notify repeatedly after recovery', async () => {
    const order = { ...baseOrder, eta: '2026-09-15T10:20:00.000Z', previous_eta: '2026-09-15T10:20:00.000Z', delivery_delay_state: 'normal' };
    const { service, notify } = setup({ durationSeconds: 60 * 60, order });

    await service.processLocation({ orderId: 'order-1', driverId: 'driver-1', latitude: 18.5, longitude: 73.8 });

    expect(notify).not.toHaveBeenCalled();
  });
});