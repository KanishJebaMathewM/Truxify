-- Migration: Add cancellation_reason to orders table

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
