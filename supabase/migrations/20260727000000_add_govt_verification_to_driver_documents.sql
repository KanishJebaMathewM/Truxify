-- Migration: Add government verification fields to driver_documents and documents
ALTER TABLE driver_documents 
  ADD COLUMN IF NOT EXISTS is_govt_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blockchain_tx_hash text;

ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS is_govt_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blockchain_tx_hash text;
