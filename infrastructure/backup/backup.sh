
#!/usr/bin/env bash
# Truxify Production Backup
# Features: PostgreSQL + MongoDB backups, age encryption,
# S3 upload, checksum verification, archive integrity checks.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

# --------------------------------------------------
# 1. CONFIGURATION
# --------------------------------------------------

BACKUP_ROOT="${BACKUP_ROOT:-/var/truxify/backups}"
S3_BUCKET="${AWS_S3_BUCKET:-truxify-backups}"
S3_PREFIX="${S3_PREFIX:-truxify}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

AGE_RECIPIENT_FILE="${AGE_RECIPIENT_FILE:-/etc/truxify/age/recipient.pub}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-/etc/truxify/age/identity.key}"

DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-truxify}"

MONGO_URI="${MONGO_URI:-}"

SHARDS=(north south east west)

BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
STAGE=""

# --------------------------------------------------
# 2. LOGGING AND ERROR HANDLING
# --------------------------------------------------

log() {
    printf '[%s] %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

error() {
    log "ERROR: $*" >&2
    exit 1
}

cleanup() {
    if [[ -n "$STAGE" && -d "$STAGE" ]]; then
        rm -rf -- "$STAGE"
        log "Temporary backup files cleaned."
    fi
}

on_error() {
    local exit_code=$?
    log "Backup failed at line ${BASH_LINENO[0]} (exit ${exit_code})."
    exit "$exit_code"
}

trap cleanup EXIT
trap on_error ERR

# --------------------------------------------------
# 3. VALIDATE CONFIGURATION
# --------------------------------------------------

log "Validating backup configuration..."

for command in pg_dump mongodump age aws tar sha256sum openssl; do
    command -v "$command" >/dev/null 2>&1 ||
        error "Required command not found: $command"
done

[[ -n "${DB_PASSWORD:-}" ]] ||
    error "DB_PASSWORD environment variable is required."

[[ -n "${SHARD_PASSWORD:-}" ]] ||
    error "SHARD_PASSWORD environment variable is required."

[[ -n "$MONGO_URI" ]] ||
    error "MONGO_URI environment variable is required."

[[ -f "$AGE_RECIPIENT_FILE" ]] ||
    error "Age recipient file not found: $AGE_RECIPIENT_FILE"

[[ -f "$AGE_IDENTITY_FILE" ]] ||
    error "Age identity file not found: $AGE_IDENTITY_FILE"

aws sts get-caller-identity >/dev/null ||
    error "AWS authentication failed."

mkdir -p -m 0700 "$BACKUP_ROOT"

STAGE="$(mktemp -d -p "$BACKUP_ROOT" ".stage.${BACKUP_ID}.XXXXXX")"
chmod 0700 "$STAGE"

log "Backup ID: $BACKUP_ID"

# --------------------------------------------------
# 4. POSTGRESQL MAIN DATABASE BACKUP
# --------------------------------------------------

log "Dumping main PostgreSQL database..."

PGPASSWORD="$DB_PASSWORD" pg_dump \
    --no-password \
    --host="$DB_HOST" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$STAGE/main_${BACKUP_ID}.dump"

[[ -s "$STAGE/main_${BACKUP_ID}.dump" ]] ||
    error "Main database backup is empty."

# --------------------------------------------------
# 5. POSTGRESQL SHARD BACKUPS
# --------------------------------------------------

for shard in "${SHARDS[@]}"; do

    log "Dumping PostgreSQL shard: $shard"

    PGPASSWORD="$SHARD_PASSWORD" pg_dump \
        --no-password \
        --host="shard-${shard}" \
        --username="$DB_USER" \
        --dbname="truxify_${shard}" \
        --format=custom \
        --no-owner \
        --no-acl \
        --file="$STAGE/shard_${shard}_${BACKUP_ID}.dump"

    [[ -s "$STAGE/shard_${shard}_${BACKUP_ID}.dump" ]] ||
        error "Shard backup is empty: $shard"

done

# --------------------------------------------------
# 6. MONGODB BACKUP
# --------------------------------------------------

log "Dumping MongoDB..."

mongodump \
    --uri="$MONGO_URI" \
    --archive="$STAGE/mongo_${BACKUP_ID}.archive" \
    --gzip

[[ -s "$STAGE/mongo_${BACKUP_ID}.archive" ]] ||
    error "MongoDB backup is empty."

# --------------------------------------------------
# 7. VERIFY DATABASE DUMP FORMATS
# --------------------------------------------------

log "Checking PostgreSQL dump files..."

for dump in "$STAGE"/*.dump; do
    pg_restore --list "$dump" >/dev/null ||
        error "Invalid PostgreSQL dump: $(basename "$dump")"
done

# --------------------------------------------------
# 8. CREATE CHECKSUM MANIFEST
# --------------------------------------------------

log "Generating backup checksums..."

(
    cd "$STAGE"

    sha256sum \
        "main_${BACKUP_ID}.dump" \
        "shard_north_${BACKUP_ID}.dump" \
        "shard_south_${BACKUP_ID}.dump" \
        "shard_east_${BACKUP_ID}.dump" \
        "shard_west_${BACKUP_ID}.dump" \
        "mongo_${BACKUP_ID}.archive" \
        > SHA256SUMS
)

# --------------------------------------------------
# 9. CREATE COMPRESSED ARCHIVE
# --------------------------------------------------

log "Creating backup archive..."

ARCHIVE="$STAGE/backup_${BACKUP_ID}.tar.gz"

tar -czf "$ARCHIVE" \
    -C "$STAGE" \
    "main_${BACKUP_ID}.dump" \
    "shard_north_${BACKUP_ID}.dump" \
    "shard_south_${BACKUP_ID}.dump" \
    "shard_east_${BACKUP_ID}.dump" \
    "shard_west_${BACKUP_ID}.dump" \
    "mongo_${BACKUP_ID}.archive" \
    SHA256SUMS

[[ -s "$ARCHIVE" ]] ||
    error "Archive creation failed."

# --------------------------------------------------
# 10. ENCRYPT WITH AGE
# --------------------------------------------------

log "Encrypting backup using age..."

RECIPIENT="$(cat "$AGE_RECIPIENT_FILE")"

[[ -n "$RECIPIENT" ]] ||
    error "Age recipient is empty."

ENCRYPTED_FILE="$STAGE/backup_${BACKUP_ID}.tar.gz.age"

age \
    --recipient "$RECIPIENT" \
    --output "$ENCRYPTED_FILE" \
    "$ARCHIVE"

[[ -s "$ENCRYPTED_FILE" ]] ||
    error "Encryption failed."

# Remove plaintext archive before upload.
rm -f -- "$ARCHIVE"

# --------------------------------------------------
# 11. UPLOAD TO AMAZON S3
# --------------------------------------------------

S3_KEY="${S3_PREFIX}/${BACKUP_ID}.tar.gz.age"
S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

log "Uploading encrypted backup to S3..."

S3_ARGS=(
    s3 cp
    "$ENCRYPTED_FILE"
    "$S3_URI"
    --region "$AWS_REGION"
    --only-show-errors
)

if [[ -n "${BACKUP_KMS_KEY_ID:-}" ]]; then
    S3_ARGS+=(
        --sse aws:kms
        --sse-kms-key-id "$BACKUP_KMS_KEY_ID"
    )
else
    S3_ARGS+=(--sse AES256)
fi

aws "${S3_ARGS[@]}"

# --------------------------------------------------
# 12. VERIFY REMOTE OBJECT
# --------------------------------------------------

log "Checking uploaded S3 object..."

REMOTE_SIZE="$(
    aws s3api head-object \
        --bucket "$S3_BUCKET" \
        --key "$S3_KEY" \
        --region "$AWS_REGION" \
        --query ContentLength \
        --output text
)"

LOCAL_SIZE="$(stat -c '%s' "$ENCRYPTED_FILE")"

[[ "$REMOTE_SIZE" == "$LOCAL_SIZE" ]] ||
    error "Uploaded object size does not match local backup."

# --------------------------------------------------
# 13. DOWNLOAD AND VERIFY BACKUP
# --------------------------------------------------

log "Downloading backup for verification..."

DOWNLOADED="$STAGE/verify_${BACKUP_ID}.age"

aws s3 cp \
    "$S3_URI" \
    "$DOWNLOADED" \
    --region "$AWS_REGION" \
    --only-show-errors

LOCAL_HASH="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"
REMOTE_HASH="$(sha256sum "$DOWNLOADED" | awk '{print $1}')"

[[ "$LOCAL_HASH" == "$REMOTE_HASH" ]] ||
    error "Downloaded backup checksum mismatch."

# --------------------------------------------------
# 14. DECRYPT AND VERIFY ARCHIVE
# --------------------------------------------------

log "Decrypting downloaded backup..."

VERIFIED_ARCHIVE="$STAGE/verified_${BACKUP_ID}.tar.gz"

age \
    --decrypt \
    --identity "$AGE_IDENTITY_FILE" \
    --output "$VERIFIED_ARCHIVE" \
    "$DOWNLOADED"

[[ -s "$VERIFIED_ARCHIVE" ]] ||
    error "Decryption produced an empty archive."

log "Testing archive integrity..."

tar -tzf "$VERIFIED_ARCHIVE" >/dev/null ||
    error "Archive integrity verification failed."

# --------------------------------------------------
# 15. VERIFY INTERNAL CHECKSUMS
# --------------------------------------------------

log "Verifying individual backup files..."

VERIFY_DIR="$STAGE/verified_contents"
mkdir -m 0700 "$VERIFY_DIR"

tar -xzf "$VERIFIED_ARCHIVE" \
    -C "$VERIFY_DIR" \
    --no-same-owner \
    --no-same-permissions

(
    cd "$VERIFY_DIR"
    sha256sum --check SHA256SUMS
) || error "One or more backup files failed checksum verification."

# Verify PostgreSQL dumps again.
for dump in "$VERIFY_DIR"/*.dump; do
    pg_restore --list "$dump" >/dev/null ||
        error "Restored archive contains an invalid dump."
done

# --------------------------------------------------
# 16. FINAL REPORT
# --------------------------------------------------

BACKUP_SIZE="$(du -h "$ENCRYPTED_FILE" | awk '{print $1}')"

log "======================================"
log "TRUXIFY BACKUP COMPLETED SUCCESSFULLY"
log "======================================"
log "Backup ID : $BACKUP_ID"
log "S3 Bucket : $S3_BUCKET"
log "S3 Object : $S3_KEY"
log "Size      : $BACKUP_SIZE"
log "Encryption: age + optional S3 SSE-KMS"
log "Integrity : Verified"
log "======================================"
