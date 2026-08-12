-- ============================================================================
-- Migration: 004_create_trip_events.sql
-- Creates the trip_events table backing offline trip-event sync
-- (backend/api/src/routes/tripRoutes.js: POST /events/batch, GET /:id/events)
-- ============================================================================
--
-- Column choices reflect exactly how tripRoutes.js reads/writes this table:
--   - event_id:        client-generated id (Flutter offline SQLite pk), used
--                       as the upsert conflict target -> TEXT PRIMARY KEY
--   - user_id:          req.user.id, the uploading user (driver or customer)
--   - trip_id:          nullable, references orders.id (trip/order identifier)
--   - event_type:       event.type (e.g. 'gpsUpdate', 'otpDelivery')
--   - event_timestamp:  event.occurred_at, ISO 8601 -> TIMESTAMPTZ
--   - latitude/longitude: parsed from payload.lat/lng, nullable
--   - metadata:          sanitized payload JSON (SENSITIVE_FIELDS stripped)
--   - created_at:        server-side insert time
--
-- NOTE: 002_rls_policies.sql's "Users read own trip_events" policy filters
-- on order_display_id, a column tripRoutes.js never populates. That policy
-- will need to be fixed separately (filed as a follow-up) — this migration
-- intentionally matches the application code, not the pre-existing policy.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS trip_events (
  event_id        TEXT PRIMARY KEY,
  user_id         UUID NOT NULL,
  trip_id         UUID NULL,
  event_type      TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  latitude        DOUBLE PRECISION NULL,
  longitude       DOUBLE PRECISION NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GET /:id/events filters/sorts by trip_id + event_timestamp
CREATE INDEX IF NOT EXISTS idx_trip_events_trip_id_timestamp
  ON trip_events (trip_id, event_timestamp);

-- Ownership checks in POST /events/batch look up by user_id
CREATE INDEX IF NOT EXISTS idx_trip_events_user_id
  ON trip_events (user_id);

-- GET /:id/events supports ?type= filtering
CREATE INDEX IF NOT EXISTS idx_trip_events_event_type
  ON trip_events (event_type);

COMMIT;