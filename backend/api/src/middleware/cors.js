import cors from "cors";

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => {
      if (!origin) return false;
      if (origin === "*") return true;
      try {
        const parsed = new URL(origin);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    });
}

// ALLOWED_ORIGINS is the single source of truth for browser origins. Keeping
// the parsed list at module scope prevents every CORS decision from rebuilding
// it and, more importantly, avoids referencing the previously undefined global.
export const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

// Inside CORS origin validation logic:

export const corsOptionsDelegate = (req, callback) => {
  const rawOrigin = req.header('Origin');
  
  // FIX: Sanitize and trim the origin string per issue #6973
  const origin = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';

  let corsOptions;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    corsOptions = { origin: true };
  } else {
    corsOptions = { origin: false };
  }
  
  callback(null, corsOptions);
};
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
