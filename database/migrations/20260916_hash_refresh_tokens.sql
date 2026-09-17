-- Store only one-way digests for bearer refresh tokens.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE refresh_tokens
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE refresh_tokens ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx
  ON refresh_tokens (token_hash);
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS token;