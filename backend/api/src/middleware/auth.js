import { firebaseAdmin, supabase, createUserClient } from "../config/db.js";
import jwt from "jsonwebtoken";
import {
  getCachedProfile,
  setCachedProfile,
  invalidateCachedProfile,
  TOMBSTONE_TTL_SECONDS,
  TTL_SECONDS,
  isValidCachedProfile,
  getCachedSupabaseProfile,
  setCachedSupabaseProfile,
  invalidateCachedSupabaseProfile,
  isValidCachedSupabaseProfile,
} from "../lib/profileCache.js";
import logger from "./logger.js";

/**
 * Safely decodes a JWT without throwing on malformed input.
 */
function safeDecodeJwt(token) {
  try {
    return jwt.decode(token);
  } catch (err) {
    return null;
  }
}

/**
 * Shared helper to format profile payload for req.user
 */
function formatUserProfile(profile) {
  return {
    id: profile.id,
    uid: profile.firebase_uid,
    role: profile.role,
    fullName: profile.full_name,
    phone: profile.phone,
    isActive: true,
  };
}

/**
 * Authentication middleware helper to verify requests using Firebase ID Tokens or Supabase Tokens.
 */
export async function verifyAuthToken(token) {
  let userProfile;
  let firebaseUid;
  let supabaseUserId = null;

  const decoded = safeDecodeJwt(token);

  const isSupabaseToken =
    decoded &&
    typeof decoded.iss === "string" &&
    (decoded.iss.includes("supabase") || decoded.iss.includes("supabase.co"));

  if (isSupabaseToken) {
    if (!supabase) {
      throw new Error("Supabase client is not configured on this server.");
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error(
        authError?.message ||
          "Invalid or expired Supabase authentication token.",
      );
    }
    supabaseUserId = user.id;

    const userClient = createUserClient?.(token) || supabase;
    const { data: profile, error } = await userClient
      .from("profiles")
      .select("id, firebase_uid, role, full_name, phone, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw new Error("Database query failed verification: " + error.message);
    }
    userProfile = profile;
  } else {
    if (!firebaseAdmin) {
      throw new Error(
        "Firebase Auth verification is not configured on this server.",
      );
    }
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
    firebaseUid = decodedToken.uid;

    // Calculate token remaining lifetime to clamp cache TTL
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenExp = decodedToken.exp || (nowSec + TTL_SECONDS);
    const tokenRemaining = tokenExp - nowSec;

    const userClient = createUserClient?.(token) || supabase;
    const { data: profile, error } = await userClient
      .from("profiles")
      .select("id, firebase_uid, role, full_name, phone, is_active")
      .eq("firebase_uid", firebaseUid)
      .maybeSingle();

      const userClient = createUserClient?.(token) || supabase;
      const { data: profile, error } = await userClient
        .from("profiles")
        .select("id, firebase_uid, role, full_name, phone")
        .eq("firebase_uid", firebaseUid)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        throw new Error("Database query failed verification: " + error.message);
      }
      userProfile = profile;

      if (userProfile) {
        // Clamp the cached profile TTL to the token's remaining lifetime so a
        // cached profile can never outlive the access token that authorised it.
        const cacheTtl = Math.max(1, Math.min(TTL_SECONDS, tokenRemaining));
        await setCachedProfile(firebaseUid, {
          id: userProfile.id,
          uid: userProfile.firebase_uid,
          role: userProfile.role,
          fullName: userProfile.full_name,
          phone: userProfile.phone,
          isActive: true,
        }, cacheTtl);
      }
    }
  }

  if (!userProfile) {
    throw new Error("User profile not found in database.");
  }

  if (userProfile.is_active === false) {
    throw new Error("User profile is inactive.");
  }

  return formatUserProfile(userProfile);
}

export async function authenticate(req, res, next) {
  const bypassAuth = process.env.BYPASS_AUTH === "true";
  const testAuthEnabled = process.env.ENABLE_TEST_AUTH === "true";

  // ── Production header sanitization ──────────────────────────────────
  if (
    process.env.NODE_ENV === "production" ||
    !bypassAuth ||
    (process.env.NODE_ENV === "test" && !testAuthEnabled)
  ) {
    delete req.headers["x-user-id"];
    delete req.headers["x-user-role"];
    delete req.headers["x-user-name"];
  }

  // Support local development bypass mode
  if (bypassAuth) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({
        error:
          "BYPASS_AUTH is enabled in production. This is a misconfiguration and must be disabled before serving traffic.",
      });
    }

    if (testAuthEnabled) {
      const testUserId = req.headers["x-user-id"];
      const testUserRole = req.headers["x-user-role"] || "customer";
      const testFullName = req.headers["x-user-name"] || "Test User";

      if (testUserId) {
        req.user = {
          id: testUserId,
          uid: "test_firebase_uid_123",
          role: testUserRole,
          fullName: testFullName,
          phone: "+919999999999",
          isActive: true,
        };
        req.token = "test-auth-token";
        return next();
      }
      return res.status(401).json({
        error: "Authentication bypassed but x-user-id header is missing.",
        hint: "Provide an x-user-id header with a valid user UUID.",
      });
    }

    const devToken = req.headers["x-dev-access-token"];
    if (
      devToken &&
      process.env.DEV_ACCESS_TOKEN &&
      devToken === process.env.DEV_ACCESS_TOKEN
    ) {
      const testUserId = devIdentity.id;
      const testUserRole = devIdentity.role || "customer";
      const testFullName = devIdentity.name || "Test User";

      if (testUserId) {
        req.user = {
          id: testUserId,
          uid: "test_firebase_uid_123",
          role: testUserRole,
          fullName: testFullName,
          phone: "+919999999999",
          isActive: true,
        };
        logger.warn(
          {
            event: "BYPASS_AUTH_USED",
            userId: testUserId,
            role: testUserRole,
            ip: req.ip,
          },
          "Authentication bypassed via DEV_ACCESS_TOKEN",
        );
        return next();
      }
    }

    return res.status(401).json({
      error: "Authentication bypass failed.",
      hint: "Provide a valid x-dev-access-token header matching DEV_ACCESS_TOKEN, along with x-user-id.",
    });
  }

  // Token Authentication Flow
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Access Denied. No token provided.",
      hint: "Include a Bearer token in the Authorization header.",
      docs: "See /docs/auth.md for authentication flow.",
    });
  }

  const token = authHeader.split(" ")[1];
  req.token = token;

  try {
    let userProfile = null;
    let firebaseUid = null;
    let supabaseUserId = null;
    let userClient = null;
    let decodedToken = null;

    const decoded = safeDecodeJwt(token);

    const isSupabaseToken =
      decoded &&
      typeof decoded.iss === "string" &&
      (decoded.iss.includes("supabase") || decoded.iss.includes("supabase.co"));

    if (isSupabaseToken) {
      if (!supabase) {
        return res
          .status(500)
          .json({ error: "Supabase client is not configured on this server." });
      }
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({
          error: "Invalid or expired Supabase authentication token.",
          details: authError?.message,
        });
      }
      supabaseUserId = user.id;
      userClient = createUserClient?.(token) || supabase;

      // Check cache for Supabase Profile
      try {
        const cachedProfile = await getCachedSupabaseProfile(supabaseUserId);
        if (cachedProfile) {
          if (!isValidCachedSupabaseProfile(supabaseUserId, cachedProfile)) {
            await invalidateCachedSupabaseProfile(supabaseUserId);
          } else if (cachedProfile.notFound) {
            return res.status(403).json({
              error: "User profile not found in database.",
              hint: "Register user in profiles table first.",
            });
          } else if (cachedProfile.isActive === false) {
            return res.status(403).json({
              error: "User profile is inactive.",
              hint: "Contact support to reactivate your account.",
            });
          } else {
            req.user = cachedProfile;
            return next();
          }
        }
      } catch (err) {
        logger.error({ err }, "Supabase cache check failed");
      }

      // Query database
      const { data: profile, error } = await userClient
        .from("profiles")
        .select("id, firebase_uid, role, full_name, phone")
        .eq("id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Database query failed verification",
          details: error.message,
        });
      }
      userProfile = profile;
    } else {
      // Firebase Verification
      if (!firebaseAdmin) {
        return res.status(500).json({
          error: "Firebase Auth verification is not configured on this server.",
        });
      }
      const verifiedFirebaseToken = await firebaseAdmin
        .auth()
        .verifyIdToken(token, true);
      decodedToken = verifiedFirebaseToken;
      firebaseUid = decodedToken.uid;

      // Check cache for Firebase Profile
      try {
        const cachedProfile = await getCachedProfile(firebaseUid);
        if (cachedProfile) {
          if (!isValidCachedProfile(firebaseUid, cachedProfile)) {
            await invalidateCachedProfile(firebaseUid);
          } else if (cachedProfile.notFound) {
            return res.status(403).json({
              error: "User profile not found in database.",
              hint: "Register user in profiles table first.",
            });
          } else if (cachedProfile.isActive === false) {
            return res.status(403).json({
              error: "User profile is inactive.",
              hint: "Contact support to reactivate your account.",
            });
          } else {
            req.user = cachedProfile;
            return next();
          }
        }
      } catch (err) {
        logger.error({ err }, "Firebase cache check failed");
      }

      if (!supabase) {
        return res
          .status(500)
          .json({ error: "Supabase client is not configured on this server." });
      }

      userClient = createUserClient?.(token) || supabase;
      const { data: profile, error } = await userClient
        .from("profiles")
        .select("id, firebase_uid, role, full_name, phone")
        .eq("firebase_uid", firebaseUid)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Database query failed verification",
          details: error.message,
        });
      }
      userProfile = profile;
    }

    if (!userProfile) {
      let profileIsDeactivated = false;
      if (supabaseUserId && userClient) {
        const { data: inactive } = await userClient
          .from("profiles")
          .select("id")
          .eq("id", supabaseUserId)
          .eq("is_active", false)
          .maybeSingle();
        profileIsDeactivated = !!inactive;
      } else if (firebaseUid && userClient) {
        const { data: inactive } = await userClient
          .from("profiles")
          .select("id")
          .eq("firebase_uid", firebaseUid)
          .eq("is_active", false)
          .maybeSingle();
        profileIsDeactivated = !!inactive;
      }

      // Set tombstone correctly differentiating deactivated vs missing profiles
      const tombstonePayload = profileIsDeactivated
        ? { isActive: false, notFound: false }
        : { isActive: false, notFound: true };

      if (firebaseUid) {
        try {
          await setCachedProfile(
            firebaseUid,
            tombstonePayload,
            TOMBSTONE_TTL_SECONDS,
          );
        }
      }
      if (supabaseUserId) {
        try {
          await setCachedSupabaseProfile(
            supabaseUserId,
            tombstonePayload,
            TOMBSTONE_TTL_SECONDS,
          );
        } catch (err) {
          logger.error({ err }, "Cache set failed");
        }
      }

        return res.status(403).json({
          error: "User profile is inactive.",
          hint: "Contact support to reactivate your account.",
        });
      }

      return res.status(403).json({
        error: "User profile not found in database.",
        hint: "Register user in profiles table first.",
      });
    }

    req.user = formatUserProfile(userProfile);

    // Cache successful DB lookup
    if (userProfile.firebase_uid) {
      try {
        // Clamp the cached profile TTL to the token's remaining lifetime so a
        // cached profile can never outlive the access token that authorised it.
        const nowSeconds = Math.floor(Date.now() / 1000);
        const firebaseTokenRemaining = decodedToken.exp
          ? decodedToken.exp - nowSeconds
          : TTL_SECONDS;
        const firebaseTtl = Math.max(1, Math.min(TTL_SECONDS, firebaseTokenRemaining));
        await setCachedProfile(userProfile.firebase_uid, req.user, firebaseTtl);
      } catch (err) {
        logger.error({ err }, "Cache set failed");
      }
    }
    if (supabaseUserId) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttlSeconds =
        isSupabaseToken && Number.isFinite(decoded?.exp)
          ? Math.min(TTL_SECONDS, decoded.exp - nowSeconds)
          : TTL_SECONDS;
      try {
        await setCachedSupabaseProfile(supabaseUserId, req.user, ttlSeconds);
      } catch (err) {
        logger.error({ err }, "Cache set failed");
      }
    }

    next();
  } catch (error) {
    logger.error(
      { err: error, requestId: req.requestId },
      "Auth verification error",
    );
    res.status(401).json({ error: "Invalid or expired authentication token." });
  }
}

export function requireRole(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error(
      "requireRole middleware requires a non-empty array of allowed roles.",
    );
  }

  // Trim each entry and drop anything that is not a non-empty string, so a
  // misconfigured array like ['admin', 42, '   '] cannot silently produce a
  // role check that never matches (denying every user) or worse, matches on
  // a garbage value.
  const sanitizedAllowedRoles = allowedRoles
    .map(r => typeof r === "string" ? r.trim() : "")
    .filter(r => r.length > 0);

  if (sanitizedAllowedRoles.length === 0) {
    throw new Error(
      "requireRole middleware requires at least one non-empty role string.",
    );
  }

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Not authenticated: req.user is missing." });
    }

    const userRole =
      typeof req.user.role === "string" ? req.user.role.trim() : "";
    if (!sanitizedAllowedRoles.includes(userRole)) {
      const requestId = req.requestId || req.id;
      logger.warn(
        {
          event: "AUTH_DENIAL",
          action: `requireRole(${sanitizedAllowedRoles.join(",")})`,
          userId: req.user.id,
          userRole: req.user.role,
          allowedRoles: sanitizedAllowedRoles,
          requestId,
        },
        `[Auth] Role denied: user=${req.user.id} role=${req.user.role} not in [${sanitizedAllowedRoles.join(",")}]`,
      );

      return res.status(403).json({
        error: "Forbidden: Insufficient privileges.",
        details: `Your account role '${req.user.role}' is not authorized to access this resource.`,
      });
    }

    next();
  };
}