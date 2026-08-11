-- Fix #7540: add missing storage_path column to documents.
-- digilockerService sync writes storage_path on documents, which previously
-- failed with PGRST204. The other columns it writes (is_govt_verified,
-- blockchain_tx_hash) already exist via the applied govt-verification migration.
alter table documents
  add column if not exists storage_path text;
