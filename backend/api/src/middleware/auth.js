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
 * Verification helper for direct programmatic calls (e.g., WebSockets, gRPC, workers).
 * Uses Redis caching and single-query DB lookup.
 */
export async function verifyAuthToken(token) {
  let decoded;
  try {
    decoded = jwt.decode(token);
  } catch (err) {
    // Ignore JWT decode errors; primary authentication logic will validate below
  }

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

    // Check Redis cache
    const cachedProfile = await getCachedSupabaseProfile(user.id);
    if (cachedProfile) {
      if (!isValidCachedSupabaseProfile(user.id, cachedProfile)) {
        await invalidateCachedSupabaseProfile(user.id).catch((err) =>
          logger.error({ err }, "Cache invalidation failed"),
        );
      } else if (cachedProfile.isActive === false) {
        throw new Error("User profile is inactive.");
      } else {
        return cachedProfile;
      }
    }

    const userClient = createUserClient?.(token) || supabase;
    const { data: profile, error } = await userClient
      .from("profiles")
      .select("id, firebase_uid, role, full_name, phone, is_active, deactivated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw new Error("Database query failed verification: " + error.message);
    }

    if (!profile) {
      await setCachedSupabaseProfile(
        user.id,
        { isActive: false },
        TOMBSTONE_TTL_SECONDS,
      ).catch((err) => logger.error({ err }, "Cache set failed"));
      throw new Error("User profile not found in database.");
    }

    if (!profile.is_active) {
      await setCachedSupabaseProfile(
        user.id,
        { isActive: false },
        TOMBSTONE_TTL_SECONDS,
      ).catch((err) => logger.error({ err }, "Cache set failed"));
      throw new Error("User profile is inactive.");
    }

    const userProfile = {
      id: profile.id,
      uid: profile.firebase_uid,
      role: profile.role,
      fullName: profile.full_name,
      phone: profile.phone,
      isActive: true,
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds =
      Number.isFinite(decoded?.exp)
        ? Math.min(TTL_SECONDS, decoded.exp - nowSeconds)
        : TTL_SECONDS;

    await setCachedSupabaseProfile(user.id, userProfile, ttlSeconds).catch(
      (err) => logger.error({ err }, "Cache set failed"),
    );

    return userProfile;
  } else {
    // Firebase Auth Verification
    if (!firebaseAdmin) {
      throw new Error(
        "Firebase Auth verification is not configured on this server.",
      );
    }
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
    const firebaseUid = decodedToken.uid;

    const cachedProfile = await getCachedProfile(firebaseUid);
    if (cachedProfile) {
      if (!isValidCachedProfile(firebaseUid, cachedProfile)) {
        await invalidateCachedProfile(firebaseUid).catch((err) =>
          logger.error({ err }, "Cache invalidation failed"),
        );
      } else if (cachedProfile.isActive === false) {
        throw new Error("User profile is inactive.");
      } else {
        return cachedProfile;
      }
    }

    // Calculate token remaining lifetime to clamp cache TTL
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenExp = decodedToken.exp || (nowSec + TTL_SECONDS);
    const tokenRemaining = tokenExp - nowSec;

    const userClient = createUserClient?.(token) || supabase;
    const { data: profile, error } = await userClient
      .from("profiles")
      .select("id, firebase_uid, role, full_name, phone, is_active, deactivated_at")
      .eq("firebase_uid", firebaseUid)
      .maybeSingle();

    if (!profile) {
      await setCachedProfile(
        firebaseUid,
        { isActive: false },
        TOMBSTONE_TTL_SECONDS,
      ).catch((err) => logger.error({ err }, "Cache set failed"));
      throw new Error("User profile not found in database.");
    }

    if (!profile.is_active) {
      await setCachedProfile(
        firebaseUid,
        { isActive: false },
        TOMBSTONE_TTL_SECONDS,
      ).catch((err) => logger.error({ err }, "Cache set failed"));
      throw new Error("User profile is inactive.");
    }

    const userProfile = {
      id: profile.id,
      uid: profile.firebase_uid,
      role: profile.role,
      fullName: profile.full_name,
      phone: profile.phone,
      isActive: true,
    };

    await setCachedProfile(firebaseUid, userProfile).catch((err) =>
      logger.error({ err }, "Cache set failed"),
    );

    return userProfile;
  }
}

/**
 * Express Middleware to authenticate API requests using Firebase or Supabase JWT tokens.
 */
export async function authenticate(req, res, next) {
  const bypassAuth = process.env.BYPASS_AUTH === "true";
  const testAuthEnabled = process.env.ENABLE_TEST_AUTH === "true";

  // ── Production header sanitization (defense in depth) ──────────────
  if (
    process.env.NODE_ENV === "production" ||
    !bypassAuth ||
    (process.env.NODE_ENV === "test" && !testAuthEnabled)
  ) {
    delete req.headers["x-user-id"];
    delete req.headers["x-user-role"];
    delete req.headers["x-user-name"];
  }

  // ── Local & Test Auth Bypass Flow ──────────────────────────────────
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
      const devIdentity = {
        id: req.headers["x-user-id"],
        role: req.headers["x-user-role"] || "customer",
        name: req.headers["x-user-name"] || "Test User",
      };
      const testUserId = devIdentity.id;
      const testUserRole = devIdentity.role;
      const testFullName = devIdentity.name;

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

  // ── Standard Token Authentication Flow ─────────────────────────────
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
    let decoded;
    try {
      decoded = jwt.decode(token);
    } catch (err) {
      // Ignore decoding error; let identity provider SDK handle verification
    }

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

      // Redis cache lookup
      try {
      const cachedProfile = await getCachedSupabaseProfile(user.id);
      if (cachedProfile) {
        if (!isValidCachedSupabaseProfile(user.id, cachedProfile)) {
          await invalidateCachedSupabaseProfile(user.id).catch((err) =>
            logger.error({ err }, "Cache invalidation failed"),
          );
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

      // Single DB query retrieves profile state including `is_active`
      const userClient = createUserClient?.(token) || supabase;
      const { data: profile, error } = await userClient
        .from("profiles")
        .select("id, firebase_uid, role, full_name, phone, is_active, deactivated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Database query failed verification",
          details: error.message,
        });
      }

      if (!profile) {
        await setCachedSupabaseProfile(
          user.id,
          { isActive: false },
          TOMBSTONE_TTL_SECONDS,
        ).catch((err) => logger.error({ err }, "Cache set failed"));

        return res.status(403).json({
          error: "User profile not found in database.",
          hint: "Register user in profiles table first.",
        });
      }

      if (!profile.is_active) {
        await setCachedSupabaseProfile(
          user.id,
          { isActive: false },
          TOMBSTONE_TTL_SECONDS,
        ).catch((err) => logger.error({ err }, "Cache set failed"));

        return res.status(403).json({
          error: "User profile is inactive.",
          hint: "Contact support to reactivate your account.",
        });
      }

      req.user = {
        id: profile.id,
        uid: profile.firebase_uid,
        role: profile.role,
        fullName: profile.full_name,
        phone: profile.phone,
        isActive: true,
      };

      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttlSeconds =
        Number.isFinite(decoded?.exp)
          ? Math.min(TTL_SECONDS, decoded.exp - nowSeconds)
          : TTL_SECONDS;

      await setCachedSupabaseProfile(user.id, req.user, ttlSeconds).catch(
        (err) => logger.error({ err }, "Cache set failed"),
      );

      return next();
    } else {
      // Firebase Verification Flow
      if (!firebaseAdmin) {
        return res.status(500).json({
          error: "Firebase Auth verification is not configured on this server.",
        });
      }

      const decodedToken = await firebaseAdmin
        .auth()
        .verifyIdToken(token, true);
      const firebaseUid = decodedToken.uid;

      // Redis Cache Check
      try {
      const cachedProfile = await getCachedProfile(firebaseUid);
      if (cachedProfile) {
        if (!isValidCachedProfile(firebaseUid, cachedProfile)) {
          await invalidateCachedProfile(firebaseUid).catch((err) =>
            logger.error({ err }, "Cache invalidation failed"),
          );
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

      // Single DB query retrieves profile state including `is_active`
      const userClient = createUserClient?.(token) || supabase;
      const { data: profile, error } = await userClient
        .from("profiles")
        .select("id, firebase_uid, role, full_name, phone, is_active, deactivated_at")
        .eq("firebase_uid", firebaseUid)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Database query failed verification",
          details: error.message,
        });
      }

      if (!profile) {
        await setCachedProfile(
          firebaseUid,
          { isActive: false },
          TOMBSTONE_TTL_SECONDS,
        ).catch((err) => logger.error({ err }, "Cache set failed"));

        return res.status(403).json({
          error: "User profile not found in database.",
          hint: "Register user in profiles table first.",
        });
      }

      if (!profile.is_active) {
        await setCachedProfile(
          firebaseUid,
          { isActive: false },
          TOMBSTONE_TTL_SECONDS,
        ).catch((err) => logger.error({ err }, "Cache set failed"));

        return res.status(403).json({
          error: "User profile is inactive.",
          hint: "Contact support to reactivate your account.",
        });
      }

      req.user = {
        id: profile.id,
        uid: profile.firebase_uid,
        role: profile.role,
        fullName: profile.full_name,
        phone: profile.phone,
        isActive: true,
      };

      await setCachedProfile(firebaseUid, req.user).catch((err) =>
        logger.error({ err }, "Cache set failed"),
      );

      return next();
    }
    }
  } catch (error) {
    logger.error(
      { err: error, requestId: req.requestId },
      "Auth verification error",
    );
    res.status(401).json({ error: "Invalid or expired authentication token." });
  }
}

/**
 * Middleware to restrict route access to specific roles.
 * Must be used after authenticate middleware.
 */
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