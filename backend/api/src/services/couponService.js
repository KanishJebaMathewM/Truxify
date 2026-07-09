import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';

function acquireLock(lockKey, ttlMs) {
  if (!redisClient) return null;
  const lockValue = `${Date.now()}_${Math.random()}`;
  return redisClient.set(lockKey, lockValue, 'PX', ttlMs, 'NX').then((result) => {
    return result === 'OK' ? lockValue : null;
  });
}

async function releaseLock(lockKey, lockValue) {
  if (!redisClient || !lockValue) return;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redisClient.eval(script, 1, lockKey, lockValue);
  } catch (err) {
    logger.error('[coupon] Lock release error:', err.message);
  }
}

export class CouponService {
  constructor(orderRepository) {
    this.orderRepository = orderRepository;
  }

  async redeemCoupon({ couponCode, customerId, orderId }) {
    const lockKey = `coupon_lock:${couponCode}`;
    const lockValue = await acquireLock(lockKey, 5000);
    if (!lockValue) {
      throw new DomainError(429, { error: 'Coupon redemption is being processed. Please try again.' });
    }

    try {
      const { data: coupon, error: fetchErr } = await this.orderRepository.findCouponByCode(couponCode);
      if (fetchErr || !coupon) {
        throw new DomainError(404, { error: 'Coupon not found or invalid.' });
      }

      if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
        throw new DomainError(410, { error: 'Coupon has reached its usage limit.' });
      }

      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        throw new DomainError(410, { error: 'Coupon has expired.' });
      }

      const { data: existing } = await this.orderRepository.findCouponRedemption(couponCode, customerId);
      if (existing) {
        throw new DomainError(409, { error: 'Coupon has already been redeemed by this customer.' });
      }

      const { data: redemption, error: redeemErr } = await this.orderRepository.redeemCouponAtomic(
        couponCode, customerId, orderId
      );
      if (redeemErr) {
        throw new DomainError(500, { error: 'Failed to redeem coupon.', details: redeemErr.message });
      }

      logger.info(`[coupon] Coupon ${couponCode} redeemed by customer ${customerId} for order ${orderId}`);

      return {
        discount_amount: redemption.discount_amount,
        discount_type: coupon.discount_type,
        coupon_code: couponCode,
      };
    } finally {
      await releaseLock(lockKey, lockValue);
    }
  }
}
