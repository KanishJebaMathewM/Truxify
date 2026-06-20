-- Migration: Add estimated_price column to orders table
-- Stores the ML-predicted freight price for display as "AI Estimate"
-- in the booking confirmation screen.
-- Nullable — orders created when the ML service is unavailable will
-- simply not have a prediction; the base pricing is always stored.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS estimated_price INTEGER;