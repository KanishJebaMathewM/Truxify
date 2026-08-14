-- Migration: create trip_events table
-- Backs POST /api/trips/events/batch and GET /api/trips/:id/events in
-- backend/api/src/routes/tripRoutes.js (upsert at line 309, select at line 462).
-- Columns match exactly what the route reads/writes.
CREATE TABLE IF NOT EXISTS trip_events (
  event_id        TEXT PRIMARY KEY,
  user_id         UUID NOT NULL,                     -- uploading user (driver or customer)
  trip_id         UUID NULL,                         -- order/trip identifier
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

-- RLS: service role manages all rows; users can only read/write their own events.
ALTER TABLE trip_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on trip_events"
  ON trip_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "users read own trip_events"
  ON trip_events FOR SELECT
  TO authenticated
  USING (user_id = get_profile_id());

CREATE POLICY "users insert own trip_events"
  ON trip_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = get_profile_id());
