import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = '20260810130000_create_blockchain_monitoring_tables.sql';
const readMigration = () =>
  readFileSync(path.resolve(__dirname, `../../../../supabase/migrations/${MIGRATION}`), 'utf8');

describe(`Migration ${MIGRATION} — blockchain monitoring tables`, () => {
  const content = readMigration();

  it('creates the three tables documented in blockchain-monitoring-setup.md', () => {
    expect(content).toMatch(/create table if not exists blockchain_monitoring_events/);
    expect(content).toMatch(/create table if not exists blockchain_escalations/);
    expect(content).toMatch(/create table if not exists blockchain_metrics/);
  });

  it('does not drop existing tables', () => {
    expect(content).not.toMatch(/DROP TABLE/);
  });

  it('defines the blockchain_monitoring_events columns the monitor inserts', () => {
    expect(content).toMatch(/type varchar/);
    expect(content).toMatch(/severity varchar/);
    expect(content).toMatch(/data jsonb/);
    expect(content).toMatch(/created_at/);
  });

  it('defines the blockchain_escalations columns the escalation handler upserts', () => {
    expect(content).toMatch(/alert_id varchar\(255\) primary key/);
    expect(content).toMatch(/alert_type varchar/);
    expect(content).toMatch(/escalation_level int/);
    expect(content).toMatch(/escalation_history jsonb/);
  });

  it('defines the blockchain_metrics columns the metrics aggregator inserts', () => {
    expect(content).toMatch(/contract_call_success_rate int/);
    expect(content).toMatch(/payment_processing_latency_avg int/);
    expect(content).toMatch(/withdrawal_queue_depth int/);
    expect(content).toMatch(/failed_transaction_count int/);
    expect(content).toMatch(/driver_payout_delay_avg int/);
    expect(content).toMatch(/blocks_scanned_per_day int/);
    expect(content).toMatch(/geofence_breach_count int/);
    expect(content).toMatch(/insurance_events_count int/);
  });

  it('adds lookup indexes for the API and monitor queries', () => {
    expect(content).toMatch(/create index if not exists idx_monitoring_events_type/i);
    expect(content).toMatch(/create index if not exists idx_monitoring_events_created_at/i);
    expect(content).toMatch(/create index if not exists idx_metrics_timestamp/i);
  });

  it('enables RLS and grants service_role full access (admin-only data)', () => {
    expect(content).toMatch(/alter table blockchain_monitoring_events enable row level security/);
    expect(content).toMatch(/alter table blockchain_escalations enable row level security/);
    expect(content).toMatch(/alter table blockchain_metrics enable row level security/);
    expect(content).toMatch(/to service_role using \(true\) with check \(true\)/);
  });
});
