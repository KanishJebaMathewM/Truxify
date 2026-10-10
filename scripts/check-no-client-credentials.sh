#!/usr/bin/env bash
# Fails if any credential-shaped string for a backend-only service (Redis /
# Upstash, in particular) shows up in the Flutter client source. These
# clients should only ever talk to the Truxify Node.js API; secrets for
# Redis, the database, or any other backend dependency belong in
# backend/api's environment, never compiled into an APK.
#
# See issue #1492: a leaked Upstash REST URL + token compiled into a
# release APK gives anyone who downloads it read/write access to the
# shared cache.

set -euo pipefail

SEARCH_PATHS=("apps/driver/lib" "apps/customer/lib" "packages")

# Patterns that would only reasonably appear if a Redis/Upstash credential
# had been pasted directly into client code.
PATTERNS=(
  'upstash\.io'
  'rediss?://[^ ]*:[^ ]*@'
  'UPSTASH_REDIS_REST_TOKEN'
  'UPSTASH_REDIS_REST_URL'
)

found=0
for path in "${SEARCH_PATHS[@]}"; do
  if [ ! -d "$path" ]; then
    continue
  fi
  for pattern in "${PATTERNS[@]}"; do
    matches=$(grep -rniE "$pattern" "$path" --include="*.dart" || true)
    if [ -n "$matches" ]; then
      echo "Found a Redis/Upstash-shaped credential in client source ($path, pattern: $pattern):"
      echo "$matches"
      found=1
    fi
  done
done

if [ "$found" -ne 0 ]; then
  echo
  echo "Backend-only credentials must never be compiled into the Flutter apps." >&2
  echo "Route this through the Truxify API instead (see backend/api)." >&2
  exit 1
fi

echo "No client-side Redis/Upstash credentials found."
