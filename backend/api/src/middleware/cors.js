import cors from "cors";
import logger from "./logger.js";
// backend/api/src/middleware/cors.js (Excerpt)

import logger from './logger.js';

// Inside CORS origin validation logic:
try {
  // ... origin parsing / regex matching logic ...
} catch (err) {
  // FIX: Bind error variable and add structured warning per issue #8342
  logger.warn({ err }, '[CORS] Failed to parse or validate request origin; falling back to deny/default');
  return false;
}
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => {
    if (!origin) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (err) {
      logger.warn('[CORS] Origin check failed:', err);
      return false;
    }
  });

const corsAllowedHeaders =
  process.env.NODE_ENV === "production"
    ? ["Content-Type", "Authorization"]
    : [
        "Content-Type",
        "Authorization",
        "x-user-id",
        "x-user-role",
        "x-user-name",
      ];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // Handle array origins (when cors config has multiple origins)
    if (Array.isArray(origin)) {
      const allowed = origin.some(o => allowedOrigins.includes(o.trim()));
      return callback(null, allowed);
    }

    const cleanOrigin = typeof origin === "string" ? origin.trim() : origin;
    if (allowedOrigins.includes(cleanOrigin)) return callback(null, true);

    if (process.env.NODE_ENV !== "production") {
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        origin,
      );
      if (isLocalhost) return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: corsAllowedHeaders,
});
