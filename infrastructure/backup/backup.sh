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
