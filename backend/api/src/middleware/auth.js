import { firebaseAdmin, supabase } from '../config/db.js';
import jwt from 'jsonwebtoken';
import { getCachedProfile, setCachedProfile, invalidateCachedProfile, TOMBSTONE_TTL_SECONDS, TTL_SECONDS, isValidCachedProfile, getCachedSupabaseProfile, setCachedSupabaseProfile, invalidateCachedSupabaseProfile, isValidCachedSupabaseProfile } from '../lib/profileCache.js';
import logger from './logger.js';

/**
 * Authentication middleware to verify requests using Firebase ID Tokens.
 * Supports BYPASS_AUTH=true and DEV_ACCESS_TOKEN environment variables
 * for easy local testing.
 *
 * In production, development auth headers (x-user-id, x-user-role, x-user-name)
 * are unconditionally stripped to prevent any possibility of bypass.
 */
export async function authenticate(req, res, next) {
  // ── Production header sanitization (defense in depth) ──────────────
  // Strip dev-only authentication headers before any logic runs.
  // This ensures they cannot be used even if BYPASS_AUTH is accidentally
  // enabled or a proxy misconfiguration exposes them.
  if (process.env.NODE_ENV === 'production' || !process.env.BYPASS_AUTH) {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-name'];
  }

  const bypassAuth = process.env.BYPASS_AUTH === 'true';

  // Support local development bypass mode using DEV_ACCESS_TOKEN
  if (bypassAuth) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'BYPASS_AUTH is enabled in production. This is a misconfiguration and must be disabled before serving traffic.'
      });
    }

    // In test mode, allow x-user-id header directly without DEV_ACCESS_TOKEN
    if (process.env.NODE_ENV === 'test') {
      const testUserId = req.headers['x-user-id'];
      const testUserRole = req.headers['x-user-role'] || 'customer';
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
      }
      return res.status(401).json({
        error: 'Authentication bypassed but x-user-id header is missing.',
        hint: 'Provide an x-user-id header with a valid user UUID.'
      });
    }

    const devToken = req.headers['x-dev-access-token'];
    if (devToken && process.env.DEV_ACCESS_TOKEN && devToken === process.env.DEV_ACCESS_TOKEN) {
      const testUserId = req.headers['x-user-id'];
      const testUserRole = req.headers['x-user-role'] || 'customer';
      const testFullName = req.headers['x-user-name'] || 'Test User';

      if (testUserId) {
        req.user = {
          id: testUserId,
          uid: 'test_firebase_uid_123',
          role: testUserRole,
          fullName: testFullName,
          phone: '+919999999999'
        };
        logger.warn({ event: 'BYPASS_AUTH_USED', userId: testUserId, role: testUserRole, ip: req.ip }, 'Authentication bypassed via DEV_ACCESS_TOKEN');
        return next();
      }
    }

    return res.status(401).json({
      error: 'Authentication bypass failed.',
      hint: 'Provide a valid x-dev-access-token header matching DEV_ACCESS_TOKEN, along with x-user-id.'
    });
  }

  // Token Authentication Flow
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access Denied. No token provided.',
      hint: 'Include a Bearer token in the Authorization header.',
      docs: 'See /docs/auth.md for authentication flow.'
    });
  }

  const token = authHeader.split(' ')[1];

  // Store the raw access token on the request so route handlers can create
  // per-request Supabase clients that carry the user's identity for RPC calls.
  req.token = token;

  try {
    let userProfile = null;
    let firebaseUid = null;
    let supabaseUserId = null;

    let decoded;
    try {
      decoded = jwt.decode(token);
    } catch (err) {
      // ignore decoding errors and let verification handle it
    }

    const isSupabaseToken = decoded && typeof decoded.iss === 'string' && (decoded.iss.includes('supabase') || decoded.iss.includes('supabase.co'));

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
            error: 'User profile is inactive.',
            hint: 'Contact support to reactivate your account.'
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
          try { await invalidateCachedProfile(firebaseUid); } catch (err) { logger.error({ err }, 'Cache invalidation failed'); }
        } else {
          if (cachedProfile.isActive === false) {
            return res.status(403).json({
              error: 'User profile is inactive.',
              hint: 'Contact support to reactivate your account.'
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
      // Check whether the profile exists but is deactivated (is_active=false).
      // The main queries above filter on is_active=true, so null could mean
      // missing OR deactivated. We distinguish here to give accurate errors.
      let profileIsDeactivated = false;
      if (supabaseUserId) {
        const { data: inactive } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', supabaseUserId)
          .eq('is_active', false)
          .maybeSingle();
        profileIsDeactivated = !!inactive;
      } else if (firebaseUid && supabase) {
        const { data: inactive } = await supabase
          .from('profiles')
          .select('id')
          .eq('firebase_uid', firebaseUid)
          .eq('is_active', false)
          .maybeSingle();
        profileIsDeactivated = !!inactive;
      }

      if (firebaseUid) {
        try { await setCachedProfile(firebaseUid, { isActive: false }, TOMBSTONE_TTL_SECONDS); } catch (err) { logger.error({ err }, 'Cache set failed'); }
      }
      if (supabaseUserId) {
        void setCachedSupabaseProfile(supabaseUserId, { isActive: false }, TOMBSTONE_TTL_SECONDS);
      }

      if (profileIsDeactivated) {
        return res.status(403).json({
          error: 'User profile is inactive.',
          hint: 'Contact support to reactivate your account.'
        });
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
      try { await setCachedProfile(userProfile.firebase_uid, req.user); } catch (err) { logger.error({ err }, 'Cache set failed'); }
    }
    if (supabaseUserId) {
      // Clamp the cache lifetime to the token's remaining validity so a cached
      // profile can never outlive the access token that authorised it.
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttlSeconds = isSupabaseToken && Number.isFinite(decoded?.exp)
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
      return res.status(401).json({ error: 'Not authenticated: req.user is missing.' });
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
