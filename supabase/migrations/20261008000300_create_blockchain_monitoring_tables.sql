-- ============================================================================
-- Migration: Create Blockchain Monitoring Tables
-- Issue: #9549 - blockchain_monitoring_events, blockchain_metrics, and 
-- blockchain_escalations are missing from migrations/setup.sql, causing PGRST202.
-- ============================================================================

BEGIN;

-- 1. Create blockchain_monitoring_events table
CREATE TABLE IF NOT EXISTS blockchain_monitoring_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    contract_address VARCHAR(255),
    tx_hash VARCHAR(255),
    block_number BIGINT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Create blockchain_metrics table
CREATE TABLE IF NOT EXISTS blockchain_metrics (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(255) NOT NULL,
    value NUMERIC(38, 18) NOT NULL,
    metadata JSONB,
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Create blockchain_escalations table
CREATE TABLE IF NOT EXISTS blockchain_escalations (
    id SERIAL PRIMARY KEY,
    incident_id VARCHAR(255),
    severity VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'open' NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    resolved_at TIMESTAMPTZ
);

-- Enable Row Level Security (RLS) on all monitoring tables
ALTER TABLE blockchain_monitoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_escalations ENABLE ROW LEVEL SECURITY;

-- Service Role Policies (Full access for backend services & background worker loops)
CREATE POLICY "blockchain_monitoring_events_service_role_all" ON blockchain_monitoring_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "blockchain_metrics_service_role_all" ON blockchain_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "blockchain_escalations_service_role_all" ON blockchain_escalations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Read Policies (Allow authenticated users and dashboard endpoints to query metrics/events/escalations)
CREATE POLICY "blockchain_monitoring_events_read" ON blockchain_monitoring_events
  FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "blockchain_metrics_read" ON blockchain_metrics
  FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "blockchain_escalations_read" ON blockchain_escalations
  FOR SELECT TO authenticated, anon USING (true);

COMMIT;
