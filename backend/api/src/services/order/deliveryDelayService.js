import { getRouteEstimate } from '../osrm.js';
import { sendPushNotification } from '../notificationService.js';
import logger from '../../middleware/logger.js';

export const DELIVERY_DELAY_THRESHOLD_MINUTES = Number.isFinite(Number(process.env.DELIVERY_DELAY_THRESHOLD_MINUTES)) && Number(process.env.DELIVERY_DELAY_THRESHOLD_MINUTES) > 0
  ? Number(process.env.DELIVERY_DELAY_THRESHOLD_MINUTES)
  : 15;

const ACTIVE_STATUSES = new Set(['active', 'truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving']);

function formatEta(eta) {
  return new Date(eta).toISOString();
}

function minutesBetween(later, earlier) {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 60000;
}

export function evaluateDeliveryDelay({ previousEta, currentEta, thresholdMinutes = DELIVERY_DELAY_THRESHOLD_MINUTES }) {
  if (!currentEta) return { state: 'unchanged', delayMinutes: 0 };
  if (!previousEta) return { state: 'baseline', delayMinutes: 0 };

  const delayMinutes = minutesBetween(currentEta, previousEta);
  if (delayMinutes >= thresholdMinutes) return { state: 'delayed', delayMinutes };
  return { state: 'recovered', delayMinutes };
}

function buildNotification({ orderDisplayId, eta, delayMinutes, state }) {
  const roundedDelay = Math.max(1, Math.round(Math.abs(delayMinutes)));
  const recovery = state === 'recovered';
  return {
    title: recovery ? 'Delivery ETA improved' : 'Delivery delay update',
    body: recovery
      ? `Order ${orderDisplayId} is now expected by ${formatEta(eta)}; the ETA improved by approximately ${roundedDelay} minutes.`
      : `Order ${orderDisplayId} is now expected by ${formatEta(eta)}; delivery is delayed by approximately ${roundedDelay} minutes.`,
    metadata: {
      order_display_id: orderDisplayId,
      updated_eta: formatEta(eta),
      delay_minutes: Math.round(delayMinutes),
      update_type: recovery ? 'recovery' : 'delay',
    },
  };
}

export class DeliveryDelayService {
  constructor({ orderRepository, routeEstimate = getRouteEstimate, notify = sendPushNotification, thresholdMinutes = DELIVERY_DELAY_THRESHOLD_MINUTES, logger: serviceLogger = logger }) {
    this.orderRepository = orderRepository;
    this.routeEstimate = routeEstimate;
    this.notify = notify;
    this.thresholdMinutes = thresholdMinutes;
    this.logger = serviceLogger;
  }

  async processLocation({ orderId, driverId, latitude, longitude }) {
    if (!orderId || !driverId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const { data: order, error } = await this.orderRepository.findOrderById(
      orderId,
      'id, order_display_id, customer_id, driver_id, status, drop_lat, drop_lng, eta, previous_eta, delivery_delay_state'
    );
    if (error || !order || order.driver_id !== driverId || !ACTIVE_STATUSES.has(order.status)) return null;

    const estimate = await this.routeEstimate({
      pickupLat: latitude,
      pickupLng: longitude,
      dropLat: Number(order.drop_lat),
      dropLng: Number(order.drop_lng),
    });
    if (!estimate || !Number.isFinite(estimate.durationSeconds)) return null;

    const currentEta = new Date(Date.now() + estimate.durationSeconds * 1000).toISOString();
    const evaluation = evaluateDeliveryDelay({
      previousEta: order.previous_eta || order.eta,
      currentEta,
      thresholdMinutes: this.thresholdMinutes,
    });
    const priorState = order.delivery_delay_state || 'normal';
    const nextState = evaluation.state === 'delayed' ? 'delayed' : 'normal';
    const shouldNotify = (nextState === 'delayed' && priorState !== 'delayed') ||
      (nextState === 'normal' && priorState === 'delayed');

    const result = await this.orderRepository.updateDeliveryEtaState(order.id, {
      eta: currentEta,
      previous_eta: nextState === 'delayed'
        ? (order.previous_eta || order.eta || currentEta)
        : currentEta,
      delivery_delay_state: nextState,
    }, order.eta, priorState);
    if (!result?.data || result.error) return null;

    if (shouldNotify) {
      const notification = buildNotification({
        orderDisplayId: order.order_display_id,
        eta: currentEta,
        delayMinutes: nextState === 'normal'
          ? minutesBetween(order.eta, currentEta)
          : evaluation.delayMinutes,
        state: nextState === 'normal' ? 'recovered' : 'delayed',
      });
      try {
        await this.notify(order.customer_id, notification.title, notification.body, 'trip_update', notification.metadata);
      } catch (notificationError) {
        this.logger.warn({ err: notificationError, orderId: order.id }, '[DeliveryDelayService] Notification failed');
      }
    }

    return { eta: currentEta, state: nextState, notified: shouldNotify };
  }
}

export default DeliveryDelayService;