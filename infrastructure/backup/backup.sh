<<<<<<< HEAD
#!/bin/bash
set -e

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/tmp/backup_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-30}"
BACKUP_ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:-}"

echo "Running pg_dump for main database..."
PGPASSWORD="${DB_PASSWORD}" pg_dump -Fc -Z 9 -h "db" -U postgres -d "truxify" > "${BACKUP_DIR}/db_${TIMESTAMP}.dump"

echo "Verifying main database dump..."
PGPASSWORD="${DB_PASSWORD}" pg_restore --list "${BACKUP_DIR}/db_${TIMESTAMP}.dump" > /dev/null

for SHARD in north south east west; do
  echo "Running pg_dump for shard-${SHARD}..."
  PGPASSWORD="${SHARD_PASSWORD}" pg_dump -Fc -Z 9 -h "shard-${SHARD}" -U postgres -d "truxify_${SHARD}" > "${BACKUP_DIR}/shard_${SHARD}_${TIMESTAMP}.dump"
  echo "Verifying shard-${SHARD} dump..."
  PGPASSWORD="${SHARD_PASSWORD}" pg_restore --list "${BACKUP_DIR}/shard_${SHARD}_${TIMESTAMP}.dump" > /dev/null
done

echo "Running mongodump..."
mongodump --uri="mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongo:27017/?authSource=admin" --archive="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive"

echo "Compressing backups..."
TARBALL="/tmp/backup_${TIMESTAMP}.tar.gz"
tar -czvf "$TARBALL" -C /tmp "backup_${TIMESTAMP}"

echo "Computing SHA256 checksum..."
sha256sum "$TARBALL" > "${TARBALL}.sha256"

UPLOAD_OBJECT="backups/backup_${TIMESTAMP}.tar.gz"

if [ -n "$BACKUP_ENCRYPTION_PASSPHRASE" ]; then
  echo "Encrypting backup archive..."
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$TARBALL" -out "${TARBALL}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "${TARBALL}.sha256" -out "${TARBALL}.sha256.enc"
  UPLOAD_FILE="${TARBALL}.enc"
  UPLOAD_CHECKSUM="${TARBALL}.sha256.enc"
  UPLOAD_OBJECT="backups/backup_${TIMESTAMP}.tar.gz.enc"
else
  echo "No BACKUP_ENCRYPTION_PASSPHRASE set; skipping encryption."
  UPLOAD_FILE="$TARBALL"
  UPLOAD_CHECKSUM="${TARBALL}.sha256"
fi

echo "Uploading to S3..."
aws s3 cp "$UPLOAD_FILE" "s3://${AWS_S3_BUCKET}/${UPLOAD_OBJECT}"
aws s3 cp "$UPLOAD_CHECKSUM" "s3://${AWS_S3_BUCKET}/${UPLOAD_OBJECT}.sha256"

echo "Verifying upload..."
LOCAL_SIZE=$(stat -c%s "$UPLOAD_FILE")
REMOTE_SIZE=$(aws s3api head-object --bucket "${AWS_S3_BUCKET}" --key "${UPLOAD_OBJECT}" --query ContentLength --output text)
if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
  echo "Upload verification failed: size mismatch (local $LOCAL_SIZE, remote $REMOTE_SIZE)"
  exit 1
fi

echo "Applying retention policy (keep ${BACKUP_RETENTION_COUNT} newest backups)..."
EXISTING=$(aws s3 ls "s3://${AWS_S3_BUCKET}/backups/" | grep -E '\.tar\.gz(\.enc)?$' | awk '{print $4}' | sort)
TOTAL=$(printf '%s\n' "$EXISTING" | grep -c . || true)
if [ "$TOTAL" -gt "$BACKUP_RETENTION_COUNT" ]; then
  TO_DELETE=$((TOTAL - BACKUP_RETENTION_COUNT))
  printf '%s\n' "$EXISTING" | head -n "$TO_DELETE" | while read -r OLD; do
    echo "Pruning old backup: $OLD"
    aws s3 rm "s3://${AWS_S3_BUCKET}/backups/${OLD}"
    aws s3 rm "s3://${AWS_S3_BUCKET}/backups/${OLD}.sha256" || true
  done
fi

echo "Cleaning up local artifacts..."
rm -rf "$BACKUP_DIR"
rm -f "$TARBALL" "${TARBALL}.sha256" "${TARBALL}.enc" "${TARBALL}.sha256.enc"

echo "Backup completed successfully."
=======
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
>>>>>>> upstream/main
