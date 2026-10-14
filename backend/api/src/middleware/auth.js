import jwt from 'jsonwebtoken';
import logger from './logger.js';
import { supabaseAdmin } from '../config/db.js';

/**
 * Caches or refreshes the active Firebase/Supabase user profile in local store / cache.
 */
async function cacheActiveFirebaseProfile(uid, profileData) {
  try {
    if (!uid) return false;
    // Ensure profile state is cached or updated
    await supabaseAdmin
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', uid)
      .maybeSingle();
    return true;
  } catch (err) {
    logger.warn({ err: err?.message, uid }, 'Failed to cache active user profile');
    return false;
  }
}

/**
 * Verifies a JWT token string against the configured secret.
 */
export async function verifyJWT(token) {
  try {
    const secret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error('JWT secret is not configured.');
    }
    const decoded = jwt.verify(token, secret);
    return decoded;
  } catch (err) {
    throw new Error(`Invalid JWT token: ${err.message}`);
  }
}

/**
 * Extracts and verifies the bearer token from request headers.
 */
export async function verifyAuthToken(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = await verifyJWT(token);
    return { token, decoded };
  } catch {
    return null;
  }
}

/**
 * Express middleware to authenticate requests using JWT Bearer tokens.
 */
export async function authenticate(req, res, next) {
  try {
    const authResult = await verifyAuthToken(req);
    if (!authResult) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    req.token = authResult.token;
    req.user = {
      id: authResult.decoded.sub || authResult.decoded.id,
      uid: authResult.decoded.uid || authResult.decoded.sub,
      role: authResult.decoded.role || 'customer',
      ...authResult.decoded,
    };

    if (req.user?.uid) {
      await cacheActiveFirebaseProfile(req.user.uid, req.user);
    }

    next();
  } catch (err) {
    logger.error({ err: err?.message }, 'Authentication middleware error');
    return res.status(401).json({ error: 'Unauthorized', details: err.message });
  }
}

/**
 * Role-based authorization middleware.
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
}

export default {
  authenticate,
  verifyJWT,
  verifyAuthToken,
  requireRole,
};
