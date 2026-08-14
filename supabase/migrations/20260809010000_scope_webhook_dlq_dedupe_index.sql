-- Migration: Scope webhook DLQ dedupe index so terminal rows don't swallow redeliveries (fixes #8838)
-- ----------------------------------------------------------------------------
-- Problem: the unique dedupe_key index created by 20260807000000 is global
-- (not scoped by status). Once a DLQ row exhausts retries and transitions to
-- 'failed_permanently' it is terminal, but a later provider redelivery of the
-- same event computes the same dedupe_key, hits the unique violation, and
-- dlqService.enqueueFailure returns true (acknowledged) without creating a new
-- row — the redelivered event is silently lost.
--
-- Fix: scope the unique index to exclude 'failed_permanently' rows so a
-- terminal row no longer blocks a fresh enqueue, while non-terminal rows
-- ('pending' / 'processing' / 'resolved') keep the idempotent-dedupe behavior.
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_webhook_failures_dedupe_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_failures_dedupe_key
  ON webhook_failures (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'failed_permanently';
