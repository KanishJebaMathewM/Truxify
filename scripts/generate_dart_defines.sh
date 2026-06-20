#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CUSTOMER_FILE="$ROOT_DIR/apps/customer/dart_define.json"
DRIVER_FILE="$ROOT_DIR/apps/driver/dart_define.json"
REQUIRED_VARS=(SUPABASE_URL SUPABASE_ANON_KEY TRUXIFY_API_BASE_URL)

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

write_json() {
  local target="$1"
  python3 - <<PY > "$target"
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
  "$PYTHON_CMD" - <<PY > "$target"
import json
import sys
import os
json.dump({
    'SUPABASE_URL': os.environ['SUPABASE_URL'],
    'SUPABASE_ANON_KEY': os.environ['SUPABASE_ANON_KEY'],
    'TRUXIFY_API_BASE_URL': os.environ['TRUXIFY_API_BASE_URL'],
}, sys.stdout, indent=2)
PY
}

export SUPABASE_URL="${env[SUPABASE_URL]}"
export SUPABASE_ANON_KEY="${env[SUPABASE_ANON_KEY]}"
export TRUXIFY_API_BASE_URL="${env[TRUXIFY_API_BASE_URL]}"

write_json "$CUSTOMER_FILE"
write_json "$DRIVER_FILE"

echo "Generated dart-define files:"
echo " - $CUSTOMER_FILE"
echo " - $DRIVER_FILE"
