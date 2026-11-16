import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn() }));
vi.mock('../../src/services/notificationService.js', () => ({ sendPushNotification: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn() } }));
import { DeliveryDelayService } from '../../src/services/order/deliveryDelayService.js';

const location = { orderId: 'order-1', driverId: 'driver-1', latitude: 18, longitude: 73 };
const baseOrder = {
  id: 'order-1', order_display_id: 'TX-1', customer_id: 'customer-1', driver_id: 'driver-1',
  status: 'in_transit', drop_lat: 18.52, drop_lng: 73.85,
  eta: '2026-10-01T10:00:00.000Z', delivery_delay_state: 'normal',
};
function setup(changes = {}) {
  const order = { ...baseOrder, ...changes };
  const orderRepository = {
    findOrderById: vi.fn().mockResolvedValue({ data: order, error: null }),
    updateDeliveryEtaState: vi.fn().mockResolvedValue({ data: { id: order.id }, error: null }),
  };
  const routeEstimate = vi.fn().mockResolvedValue({ durationSeconds: 60 * 80 });
  const notify = vi.fn().mockResolvedValue({ success: true });
  const service = new DeliveryDelayService({ orderRepository, routeEstimate, notify });
  return { service, orderRepository, routeEstimate, notify };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('delivery ETA coordinate validation', () => {
  it.each([
    null, undefined, '', '  ', false, true, [], [0], {}, NaN, Infinity, 'NaN', 'Infinity', 'abc',
  ])('skips invalid destination latitude %j before routing or writes', async dropLat => {
    const { service, routeEstimate, orderRepository, notify } = setup({ drop_lat: dropLat });
    await expect(service.processLocation(location)).resolves.toBeNull();
    expect(routeEstimate).not.toHaveBeenCalled();
    expect(orderRepository.updateDeliveryEtaState).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it.each([
    { drop_lat: 90.01 }, { drop_lat: -90.01 },
    { drop_lng: 180.01 }, { drop_lng: -180.01 },
    { drop_lng: null }, { drop_lng: '' }, { drop_lng: Infinity },
  ])('skips invalid destination pair %j', async coordinates => {
    const { service, routeEstimate, orderRepository, notify } = setup(coordinates);
    await expect(service.processLocation(location)).resolves.toBeNull();
    expect(routeEstimate).not.toHaveBeenCalled();
    expect(orderRepository.updateDeliveryEtaState).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it.each([
    { latitude: 90.01 }, { latitude: -90.01 }, { longitude: 180.01 }, { longitude: -180.01 },
    { latitude: null }, { latitude: '18' }, { longitude: NaN },
  ])('skips invalid driver coordinate %j before reading the order', async coordinates => {
    const { service, routeEstimate, orderRepository, notify } = setup();
    await expect(service.processLocation({ ...location, ...coordinates })).resolves.toBeNull();
    expect(orderRepository.findOrderById).not.toHaveBeenCalled();
    expect(routeEstimate).not.toHaveBeenCalled();
    expect(orderRepository.updateDeliveryEtaState).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it.each([
    [0, 0], ['0', '0'], ['18.52', '73.85'], [-90, -180], [90, 180],
  ])('routes genuine destination coordinates %j / %j and retains ETA compare-and-set', async (lat, lng) => {
    const { service, routeEstimate, orderRepository, notify } = setup({ drop_lat: lat, drop_lng: lng });
    const result = await service.processLocation({ ...location, latitude: 0, longitude: 0 });
    expect(routeEstimate).toHaveBeenCalledWith({ pickupLat: 0, pickupLng: 0, dropLat: Number(lat), dropLng: Number(lng) });
    expect(orderRepository.updateDeliveryEtaState).toHaveBeenCalledWith('order-1', {
      eta: '2026-10-01T10:20:00.000Z', previous_eta: baseOrder.eta, delivery_delay_state: 'delayed',
    }, baseOrder.eta, 'normal');
    expect(result).toEqual({ eta: '2026-10-01T10:20:00.000Z', state: 'delayed', notified: true });
    expect(notify).toHaveBeenCalledOnce();
  });
  it.each([{ driver_id: 'other' }, { status: 'completed' }])('retains ownership/status checks %j', async changes => {
    const { service, routeEstimate, orderRepository } = setup(changes);
    await expect(service.processLocation(location)).resolves.toBeNull();
    expect(routeEstimate).not.toHaveBeenCalled();
    expect(orderRepository.updateDeliveryEtaState).not.toHaveBeenCalled();
  });
});
