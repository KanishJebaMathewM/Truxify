#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CUSTOMER_FILE="$ROOT_DIR/apps/customer/dart_define.json"
DRIVER_FILE="$ROOT_DIR/apps/driver/dart_define.json"
REQUIRED_VARS=(SUPABASE_URL SUPABASE_ANON_KEY TRUXIFY_API_BASE_URL FIREBASE_API_KEY FIREBASE_PROJECT_ID FIREBASE_MESSAGING_SENDER_ID FIREBASE_CUSTOMER_APP_ID FIREBASE_DRIVER_APP_ID)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

declare -A env
while IFS='=' read -r key value; do
  key="${key%%[[:space:]]*}"
  if [[ -z "$key" || "${key:0:1}" == "#" ]]; then
    continue
  fi
  value="${value%%#*}"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  if [[ ("${value:0:1}" == '"' && "${value: -1}" == '"') || ("${value:0:1}" == "'" && "${value: -1}" == "'") ]]; then
    value="${value:1:-1}"
  fi
  env["$key"]="$value"
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/[[:space:]]*#.*$//')

missing=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${env[$var]:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required variable:"
  for var in "${missing[@]}"; do
    echo "$var"
  done
  exit 1
fi

# Detect Python command
PYTHON_CMD="python3"
if ! command -v python3 &>/dev/null; then
  if command -v python &>/dev/null; then
    PYTHON_CMD="python"
  else
    echo "Error: Python is required but not installed."
    exit 1
  fi
fi

write_json() {
  local target="$1"
  local app_id="$2"
  FIREBASE_APP_ID_VALUE="$app_id" "$PYTHON_CMD" - <<PY > "$target"
import json
import sys
import os
json.dump({
    'SUPABASE_URL': os.environ['SUPABASE_URL'],
    'SUPABASE_ANON_KEY': os.environ['SUPABASE_ANON_KEY'],
    'TRUXIFY_API_BASE_URL': os.environ['TRUXIFY_API_BASE_URL'],
    'FIREBASE_API_KEY': os.environ['FIREBASE_API_KEY'],
    'FIREBASE_APP_ID': os.environ['FIREBASE_APP_ID_VALUE'],
    'FIREBASE_MESSAGING_SENDER_ID': os.environ['FIREBASE_MESSAGING_SENDER_ID'],
    'FIREBASE_PROJECT_ID': os.environ['FIREBASE_PROJECT_ID'],
    'FIREBASE_STORAGE_BUCKET': os.environ.get('FIREBASE_STORAGE_BUCKET', ''),
    'FIREBASE_AUTH_DOMAIN': os.environ.get('FIREBASE_AUTH_DOMAIN', ''),
}, sys.stdout, indent=2)
PY
}

export SUPABASE_URL="${env[SUPABASE_URL]}"
export SUPABASE_ANON_KEY="${env[SUPABASE_ANON_KEY]}"
export TRUXIFY_API_BASE_URL="${env[TRUXIFY_API_BASE_URL]}"
export FIREBASE_API_KEY="${env[FIREBASE_API_KEY]}"
export FIREBASE_MESSAGING_SENDER_ID="${env[FIREBASE_MESSAGING_SENDER_ID]}"
export FIREBASE_PROJECT_ID="${env[FIREBASE_PROJECT_ID]}"
export FIREBASE_STORAGE_BUCKET="${env[FIREBASE_STORAGE_BUCKET]:-}"
export FIREBASE_AUTH_DOMAIN="${env[FIREBASE_AUTH_DOMAIN]:-}"

write_json "$CUSTOMER_FILE" "${env[FIREBASE_CUSTOMER_APP_ID]}"
write_json "$DRIVER_FILE" "${env[FIREBASE_DRIVER_APP_ID]}"

echo "Generated dart-define files:"
echo " - $CUSTOMER_FILE"
echo " - $DRIVER_FILE"
