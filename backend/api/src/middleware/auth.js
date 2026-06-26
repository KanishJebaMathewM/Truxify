import { firebaseAdmin, supabase } from '../config/db.js';
import jwt from 'jsonwebtoken';
import { getCachedProfile, setCachedProfile, invalidateCachedProfile, TOMBSTONE_TTL_SECONDS, TTL_SECONDS, isValidCachedProfile, getCachedSupabaseProfile, setCachedSupabaseProfile, invalidateCachedSupabaseProfile, isValidCachedSupabaseProfile } from '../lib/profileCache.js';
import logger from './logger.js';

/**
 * Authentication middleware to verify requests using Firebase ID Tokens.
 * Supports BYPASS_AUTH=true environment variable for easy local testing.
 *
 * In production, development auth headers (x-user-id, x-user-role, x-user-name)
 * are unconditionally stripped to prevent any possibility of bypass.
 */
export async function authenticate(req, res, next) {
  // ── Production header sanitization (defense in depth) ──────────────
  // Strip dev-only authentication headers before any logic runs.
  // This ensures they cannot be used even if BYPASS_AUTH is accidentally
  // enabled or a proxy misconfiguration exposes them.
  if (process.env.NODE_ENV === 'production') {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-name'];
  }

  const bypassAuth = process.env.BYPASS_AUTH === 'true';

  // Support local development bypass mode
  if (bypassAuth) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'BYPASS_AUTH is enabled in production. This is a misconfiguration and must be disabled before serving traffic.'
      });
    }
    const testUserId = req.headers['x-user-id']; // e.g. a Supabase profile UUID
    const testUserRole = req.headers['x-user-role'] || 'customer'; // customer or driver
    const testFullName = req.headers['x-user-name'] || 'Test User';

    if (testUserId) {
      req.user = {
        id: testUserId,
        uid: 'test_firebase_uid_123',
        role: testUserRole,
        fullName: testFullName,
        phone: '+919999999999'
      };
      return next();
    } else {
      return res.status(401).json({
        error: 'Authentication bypassed but x-user-id header is missing.',
        hint: 'Provide a valid profile UUID in the x-user-id header when BYPASS_AUTH is enabled.'
      });
    }
  }

  // Token Authentication Flow
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access Denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    let userProfile = null;
    let decoded = null;
    let firebaseUid = null;
    let supabaseUserId = null;

    try {
      decoded = jwt.decode(token);
    } catch (err) {
      // ignore decoding errors and let verification handle it
    }

    const isSupabaseToken = decoded && decoded.iss && (decoded.iss.includes('supabase') || decoded.iss.includes('supabase.co'));

    if (isSupabaseToken) {
      if (!supabase) {
        return res.status(500).json({ error: 'Supabase client is not configured on this server.' });
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid or expired Supabase authentication token.', details: authError?.message });
      }
      supabaseUserId = user.id;

      // Token is verified above; the cache only skips the profile lookup, keyed
      // by the verified user id. Cache entries are bounded by the token's own
      // expiry (see TTL calculation below) so a revoked session cannot be served.
      const cachedProfile = await getCachedSupabaseProfile(supabaseUserId);
      if (cachedProfile) {
        if (!isValidCachedSupabaseProfile(supabaseUserId, cachedProfile)) {
          void invalidateCachedSupabaseProfile(supabaseUserId);
        } else if (cachedProfile.isActive === false) {
          return res.status(403).json({
            error: 'User profile not found in database.',
            hint: 'Register user in profiles table first.'
          });
        } else {
          req.user = cachedProfile;
          return next();
        }
      }

      // Fetch corresponding profile from Supabase by user.id
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, firebase_uid, role, full_name, phone')
        .eq('id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: 'Database query failed verification', details: error.message });
      }
      userProfile = profile;
    } else {
      // Firebase Verification
      if (!firebaseAdmin) {
        return res.status(500).json({ error: 'Firebase Auth verification is not configured on this server.' });
      }
      const decodedToken = await firebaseAdmin.auth().verifyIdToken(token);
      firebaseUid = decodedToken.uid;

      // Check Redis cache first.
      // NOTE: On cache hit, we attach the cached profile directly and skip the DB query entirely
      // to reduce database load (per the Acceptance Criteria).
      // Since all profile mutations in this API (e.g., PUT /api/profile) invalidate the cache,
      // the cache remains consistent. Any future administrative role or status mutations
      // must explicitly call invalidateCachedProfile(firebaseUid).
      const cachedProfile = await getCachedProfile(firebaseUid);
      if (cachedProfile) {
        if (!isValidCachedProfile(firebaseUid, cachedProfile)) {
          try { await invalidateCachedProfile(firebaseUid); } catch (_) { logger.error('Cache invalidation failed', _); }
        } else {
          if (cachedProfile.isActive === false) {
            return res.status(403).json({ 
              error: 'User profile not found in database.', 
              hint: 'Register user in profiles table first.' 
            });
          }
          req.user = cachedProfile;
          return next();
        }
      }

      if (!supabase) {
        return res.status(500).json({ error: 'Supabase client is not configured on this server.' });
      }

      // Fetch corresponding profile from Supabase by firebase_uid
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, firebase_uid, role, full_name, phone')
        .eq('firebase_uid', firebaseUid)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: 'Database query failed verification', details: error.message });
      }
      userProfile = profile;
    }

    if (!userProfile) {
      if (firebaseUid) {
        try { await setCachedProfile(firebaseUid, { isActive: false }, TOMBSTONE_TTL_SECONDS); } catch (_) { logger.error('Cache set failed', _); }
      }
      if (supabaseUserId) {
        void setCachedSupabaseProfile(supabaseUserId, { isActive: false }, TOMBSTONE_TTL_SECONDS);
      }
      return res.status(403).json({
        error: 'User profile not found in database.',
        hint: 'Register user in profiles table first.'
      });
    }

    // Attach user data to request context
    req.user = {
      id: userProfile.id,
      uid: userProfile.firebase_uid,
      role: userProfile.role,
      fullName: userProfile.full_name,
      phone: userProfile.phone,
      isActive: true
    };

    // Populate cache on successful DB fetch
    if (userProfile.firebase_uid) {
      try { await setCachedProfile(userProfile.firebase_uid, req.user); } catch (_) { logger.error('Cache set failed', _); }
    }
    if (supabaseUserId) {
      // Clamp the cache lifetime to the token's remaining validity so a cached
      // profile can never outlive the access token that authorised it.
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttlSeconds = Number.isFinite(decoded?.exp)
        ? Math.min(TTL_SECONDS, decoded.exp - nowSeconds)
        : TTL_SECONDS;
      void setCachedSupabaseProfile(supabaseUserId, req.user, ttlSeconds);
    }

    next();
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Auth verification error');
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * Middleware to restrict route access to specific roles.
 * Must be used after authenticate middleware.
 */
export function requireRole(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('requireRole middleware requires a non-empty array of allowed roles.');
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(500).json({ error: 'Security middleware configuration error: missing req.user.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden: Insufficient privileges.',
        details: `Your account role '${req.user.role}' is not authorized to access this resource.`
      });
    }

    next();
  };
}
