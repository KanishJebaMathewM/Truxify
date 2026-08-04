#!/bin/bash
set -e

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/tmp/backup_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "Running pg_dump for main database..."
PGPASSWORD="${DB_PASSWORD}" pg_dump -h "db" -U postgres -d "truxify" > "${BACKUP_DIR}/db_${TIMESTAMP}.sql"

for SHARD in north south east west; do
  echo "Running pg_dump for shard-${SHARD}..."
  PGPASSWORD="${SHARD_PASSWORD}" pg_dump -h "shard-${SHARD}" -U postgres -d "truxify_${SHARD}" > "${BACKUP_DIR}/shard_${SHARD}_${TIMESTAMP}.sql"
done

echo "Running mongodump..."
mongodump --uri="mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongo:27017/?authSource=admin" --archive="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive"

echo "Compressing backups..."
tar -czvf "/tmp/backup_${TIMESTAMP}.tar.gz" -C /tmp "backup_${TIMESTAMP}"

echo "Uploading to S3..."
aws s3 cp "/tmp/backup_${TIMESTAMP}.tar.gz" "s3://${AWS_S3_BUCKET}/backups/"

echo "Cleaning up..."
rm -rf "$BACKUP_DIR"
rm "/tmp/backup_${TIMESTAMP}.tar.gz"

echo "Backup completed successfully."
