-- Migration: Add Proof of Delivery hash columns to orders
-- SHA-256 hashes of uploaded photo and signature for integrity verification
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pod_signature_hash TEXT,
  ADD COLUMN IF NOT EXISTS pod_photo_hash TEXT;
