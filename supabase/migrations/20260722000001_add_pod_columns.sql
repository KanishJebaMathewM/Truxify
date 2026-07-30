-- Migration: Add Proof of Delivery columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pod_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS pod_photo_url TEXT;
