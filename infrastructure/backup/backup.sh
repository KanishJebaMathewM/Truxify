#!/usr/bin/env bash
# Production backup script with encryption, verification, and secure handling
set -euo pipefail

# Configuration (all sensitive values via env vars)
BACKUP_ROOT="${BACKUP_ROOT:-/var/truxify/backups}"
S3_BUCKET="${AWS_S3_BUCKET:-truxify-backups}"
KMS_KEY_ID="${BACKUP_KMS_KEY_ID:-}"
AGE_RECIPIENT_FILE="${AGE_RECIPIENT_FILE:-/etc/truxify/age/recipient.pub}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-/etc/truxify/age/identity.key}"

umask 077
mkdir -p -m 0700 "$BACKUP_ROOT"

BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="$(mktemp -d -p "$BACKUP_ROOT" .stage.XXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# 1) Dump databases into private staging dir (mode 0700 from umask)
log "Dumping main database..."
PGPASSWORD="${DB_PASSWORD}" pg_dump -h "db" -U postgres -d "truxify" > "${STAGE}/db_${BACKUP_ID}.sql"

for SHARD in north south east west; do
  log "Dumping shard ${SHARD}..."
  PGPASSWORD="${SHARD_PASSWORD}" pg_dump -h "shard-${SHARD}" -U postgres -d "truxify_${SHARD}" > "${STAGE}/shard_${SHARD}_${BACKUP_ID}.sql"
done

log "Dumping MongoDB..."
mongodump --uri="mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongo:27017/?authSource=admin" --archive="${STAGE}/mongo_${BACKUP_ID}.archive"

# 2) Create archive and encrypt
log "Creating and encrypting backup archive..."
tar -czf "${STAGE}/backup_${BACKUP_ID}.tar.gz" -C "$STAGE" \
  "db_${BACKUP_ID}.sql" \
  shard_north_${BACKUP_ID}.sql \
  shard_south_${BACKUP_ID}.sql \
  shard_east_${BACKUP_ID}.sql \
  shard_west_${BACKUP_ID}.sql \
  "mongo_${BACKUP_ID}.archive"

# Encrypt with age (preferred) or AWS KMS envelope
if [[ -f "$AGE_RECIPIENT_FILE" ]]; then
  log "Encrypting with age..."
  age -r "$(cat "$AGE_RECIPIENT_FILE")" -o "${STAGE}/backup_${BACKUP_ID}.tar.gz.age" "${STAGE}/backup_${BACKUP_ID}.tar.gz"
  ENCRYPTED_FILE="${STAGE}/backup_${BACKUP_ID}.tar.gz.age"
elif [[ -n "$KMS_KEY_ID" ]]; then
  log "Encrypting with AWS KMS..."
  aws kms encrypt --key-id "$KMS_KEY_ID" --plaintext fileb://"${STAGE}/backup_${BACKUP_ID}.tar.gz" --output text --query CiphertextBlob | base64 -d > "${STAGE}/backup_${BACKUP_ID}.tar.gz.enc"
  ENCRYPTED_FILE="${STAGE}/backup_${BACKUP_ID}.tar.gz.enc"
else
  log "ERROR: No encryption method configured (set AGE_RECIPIENT_FILE or BACKUP_KMS_KEY_ID)" >&2
  exit 1
fi

# 3) Upload with explicit server-side encryption
log "Uploading encrypted backup to S3..."
if [[ -f "$AGE_RECIPIENT_FILE" ]]; then
  aws s3 cp "$ENCRYPTED_FILE" "s3://${S3_BUCKET}/truxify/${BACKUP_ID}.tar.gz.age" \
    --sse aws:kms --sse-kms-key-id "${KMS_KEY_ID:-aws/s3}"
elif [[ -n "$KMS_KEY_ID" ]]; then
  aws s3 cp "$ENCRYPTED_FILE" "s3://${S3_BUCKET}/truxify/${BACKUP_ID}.tar.gz.enc" \
    --sse aws:kms --sse-kms-key-id "$KMS_KEY_ID"
fi

# 4) Verify restorability (download, decrypt, test archive integrity)
log "Verifying backup restorability..."
aws s3 cp "s3://${S3_BUCKET}/truxify/$(basename "$ENCRYPTED_FILE")" "${STAGE}/verify_$(basename "$ENCRYPTED_FILE")" \
  --sse aws:kms --sse-kms-key-id "${KMS_KEY_ID:-aws/s3}"

if [[ -f "$AGE_RECIPIENT_FILE" && -f "$AGE_IDENTITY_FILE" ]]; then
  age -d -i "$AGE_IDENTITY_FILE" -o "${STAGE}/verify.tar.gz" "${STAGE}/verify_$(basename "$ENCRYPTED_FILE")"
elif [[ -n "$KMS_KEY_ID" ]]; then
  base64 -d "${STAGE}/verify_$(basename "$ENCRYPTED_FILE")" | aws kms decrypt --key-id "$KMS_KEY_ID" --ciphertext-blob fileb:///dev/stdin --output text --query Plaintext | base64 -d > "${STAGE}/verify.tar.gz"
fi

tar tzf "${STAGE}/verify.tar.gz" > /dev/null
log "Backup archive integrity verified."

# 5) Clean up staging (temp files auto-removed by trap)
log "Backup completed successfully: s3://${S3_BUCKET}/truxify/$(basename "$ENCRYPTED_FILE")"