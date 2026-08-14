#!/bin/bash
# Regression check for infrastructure/backup/backup.sh
# Verifies the backup script is syntactically valid and contains the
# hardening features introduced for issue #11551.
#
# Testing limitations: this does NOT execute a real pg_dump / mongodump /
# aws s3 upload (no database, no S3 credentials, no network). It only
# performs static validation so it can run in CI without side effects.

set -e

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${SCRIPT_DIR}/backup.sh"

echo "Running syntax check (bash -n)..."
bash -n "$TARGET"

echo "Checking required hardening features are present..."

missing=0

check() {
  if ! grep -q "$1" "$TARGET"; then
    echo "MISSING: $2"
    missing=1
  else
    echo "OK: $2"
  fi
}

check 'pg_dump -Fc -Z 9' "compressed custom-format pg_dump"
check 'pg_restore --list' "dump verification via pg_restore --list"
check 'sha256sum' "SHA256 checksum generation"
check 'openssl enc' "encryption with openssl"
check 'BACKUP_ENCRYPTION_PASSPHRASE' "encryption key read from environment"
check 'head-object' "upload verification via head-object"
check 'BACKUP_RETENTION_COUNT' "configurable retention count"
check 'aws s3 rm' "retention prune of old backups"

if [ "$missing" -ne 0 ]; then
  echo "Regression check FAILED: one or more required features missing."
  exit 1
fi

echo "Regression check PASSED."
