import cors from "cors";

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => {
    if (!origin) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
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
