import crypto from 'crypto';
import logger from '../middleware/logger.js';

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_EXPIRY_DAYS = 7;

export class TrackingTokenService {
  constructor({ supabase, logger: injectedLogger }) {
    this._supabase = supabase;
    this._logger = injectedLogger || logger;
  }

  generateRawToken() {
    return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  }

  hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  getExpiryDate() {
    const expires = new Date();
    expires.setDate(expires.getDate() + TOKEN_EXPIRY_DAYS);
    return expires.toISOString();
  }

  async createToken({ orderDisplayId, createdBy }) {
    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = this.getExpiryDate();

    const { data, error } = await this._supabase
      .from('tracking_tokens')
      .insert({
        order_display_id: orderDisplayId,
        token_hash: tokenHash,
        created_by: createdBy,
        expires_at: expiresAt,
      })
      .select('id, order_display_id, expires_at, created_at')
      .single();

    if (error) {
      this._logger.error({ error, orderDisplayId }, 'Failed to create tracking token');
      throw new Error('Failed to create tracking token');
    }

    return { ...data, token: rawToken };
  }

  async validateToken(rawToken) {
    const tokenHash = this.hashToken(rawToken);

    const { data: token, error } = await this._supabase
      .from('tracking_tokens')
      .select('id, order_display_id, expires_at, revoked, revoked_at')
      .eq('token_hash', tokenHash)
      .single();

    if (error || !token) {
      return { valid: false, reason: 'not_found' };
    }

    if (token.revoked) {
      return { valid: false, reason: 'revoked' };
    }

    if (new Date(token.expires_at) < new Date()) {
      return { valid: false, reason: 'expired', tokenId: token.id };
    }

    return { valid: true, orderDisplayId: token.order_display_id, tokenId: token.id };
  }

  async revokeToken(tokenId) {
    const { error } = await this._supabase
      .from('tracking_tokens')
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq('id', tokenId);

    if (error) {
      this._logger.error({ error, tokenId }, 'Failed to revoke tracking token');
      throw new Error('Failed to revoke tracking token');
    }
  }

  async revokeAllForOrder(orderDisplayId) {
    const { error } = await this._supabase
      .from('tracking_tokens')
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq('order_display_id', orderDisplayId)
      .eq('revoked', false);

    if (error) {
      this._logger.error({ error, orderDisplayId }, 'Failed to revoke tracking tokens for order');
    }
  }

  async purgeExpiredTokens() {
    const { data, error } = await this._supabase
      .from('tracking_tokens')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      this._logger.error({ error }, 'Failed to purge expired tracking tokens');
      return 0;
    }

    const count = data?.length ?? 0;
    if (count > 0) {
      this._logger.info({ purgedCount: count }, 'Purged expired tracking tokens');
    }
    return count;
  }

  async getActiveTokensForOrder(orderDisplayId) {
    const { data, error } = await this._supabase
      .from('tracking_tokens')
      .select('id, expires_at, created_at')
      .eq('order_display_id', orderDisplayId)
      .eq('revoked', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      this._logger.error(
        { error, orderDisplayId },
        'Failed to fetch active tracking tokens'
      );
      throw new Error('Failed to fetch active tracking tokens');
    }

    return data || [];
  }

  async getOrderForPublicTracking(orderDisplayId) {
    const { data: order, error: orderError } = await this._supabase
      .from('orders')
      .select(`
        order_display_id,
        status,
        pickup_address,
        pickup_lat,
        pickup_lng,
        drop_address,
        drop_lat,
        drop_lng,
        pickup_date,
        pickup_time,
        goods_type,
        weight_tonnes,
        driver_name,
        driver_rating,
        truck_number,
        eta,
        created_at
      `)
      .eq('order_display_id', orderDisplayId)
      .single();

    if (orderError || !order) {
      return null;
    }

    return order;
  }

  async getOrderTimeline(orderDisplayId) {
    const { data, error } = await this._supabase
      .from('order_timeline')
      .select('milestone, milestone_time, completed, sort_order')
      .eq('order_display_id', orderDisplayId)
      .order('sort_order', { ascending: true });

    if (error) {
      return [];
    }

    return data || [];
  }

  async getDriverLocation(orderDisplayId) {
    const { data: order, error: orderError } = await this._supabase
      .from('orders')
      .select('driver_id')
      .eq('order_display_id', orderDisplayId)
      .single();

    if (orderError || !order || !order.driver_id) {
      return null;
    }

    const { data: location, error: locationError } = await this._supabase
      .from('driver_locations')
      .select('latitude, longitude, last_updated_at')
      .eq('driver_id', order.driver_id)
      .eq('is_active', true)
      .order('last_updated_at', { ascending: false })
      .limit(1)
      .single();

    if (locationError) {
      this._logger.error(
        { error: locationError, orderDisplayId, driverId: order.driver_id },
        'Failed to fetch public tracking driver location'
      );
      return null;
    }

    return location || null;
  }
}
