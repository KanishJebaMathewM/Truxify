-- Migration: Add detention time and fee tracking to orders
-- This adds tracking for excess wait times at warehouses.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS detention_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detention_fee INTEGER DEFAULT 0;
