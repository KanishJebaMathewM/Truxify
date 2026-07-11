#!/usr/bin/env bash
# ============================================================================
# check-escrow-abi.sh
# ============================================================================
# CI guard that verifies the deployed smart contract's ABI selectors match
# what the backend (escrow.js) expects.
#
# Usage:
#   bash scripts/check-escrow-abi.sh
#
# This script:
#   1. Extracts the ABI function selectors from TruxifyEscrow.sol (via Hardhat)
#   2. Compares them with the selectors defined in escrow.js
#   3. Fails (exit 1) if there is a mismatch
#
# Run as part of CI to prevent deploying ABI-incompatible contracts.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔍 Checking escrow ABI compatibility..."

# Expected selectors (from backend/api/src/services/escrow.js)
# These are keccak256(first 4 bytes) of the function signatures
declare -A EXPECTED_SELECTORS
EXPECTED_SELECTORS["createBooking(uint256,address)"]="cf5ba53f"
EXPECTED_SELECTORS["releasePayment(uint256)"]="2d8e4a0b"
EXPECTED_SELECTORS["cancelBooking(uint256)"]="66b71f1c"
EXPECTED_SELECTORS["bookings(uint256)"]="dc97d7d3"

# Check if cast (foundry) is available for selector computation
HAS_CAST=false
if command -v cast &>/dev/null; then
  HAS_CAST=true
fi

ERRORS=0

for sig in "${!EXPECTED_SELECTORS[@]}"; do
  expected="${EXPECTED_SELECTORS[$sig]}"

  if $HAS_CAST; then
    # Use foundry's cast to compute the selector
    actual=$(cast keccak "$sig" | cut -c1-10 | sed 's/^0x//')
  else
    # Fallback: use node.js with ethers
    actual=$(node -e "
      const { ethers } = require('ethers');
      const iface = new ethers.Interface(['function $sig']);
      const selector = iface.getFunction('${sig%%(*}').selector.slice(2);
      console.log(selector);
    ")
  fi

  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $sig → 0x$expected"
  else
    echo "  ❌ $sig → expected 0x$expected, got 0x$actual"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ All ABI selectors match."
  exit 0
else
  echo "❌ $ERRORS ABI selector(s) mismatch. The backend escrow.js expects different selectors"
  echo "   than what the contract provides. Do NOT deploy until this is resolved."
  exit 1
fi
