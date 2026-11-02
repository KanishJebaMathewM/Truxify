
#!/usr/bin/env bash
# ============================================================================
# check-escrow-abi.sh
# CI guard for verifying backend escrow ABI selectors against the compiled
# TruxifyEscrow contract.
#
# Usage:
#   bash scripts/check-escrow-abi.sh
#
# Requirements:
#   - Foundry cast OR ethers installed in blockchain/node_modules
#   - Hardhat and the TruxifyEscrow contract
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BLOCKCHAIN_DIR="$ROOT_DIR/blockchain"
SOL_FILE="$BLOCKCHAIN_DIR/contracts/TruxifyEscrow.sol"
ARTIFACT_FILE="$BLOCKCHAIN_DIR/artifacts/contracts/TruxifyEscrow.sol/TruxifyEscrow.json"

echo "Checking escrow ABI compatibility..."

# Expected selectors used by backend/api/src/services/escrow.js
declare -A EXPECTED_SELECTORS=(
  ["createBooking(uint256,address,bytes)"]="0bb7aa51"
  ["lockPayment(uint256,address,address)"]="044e8539"
  ["commitmentNonces(address,uint256)"]="699ef9bb"
  ["releasePayment(uint256)"]="88685cd9"
  ["cancelBooking(uint256)"]="0dca825e"
  ["cancelWithPenalty(uint256,uint256)"]="ca9a63b1"
  ["markBookingStarted(uint256)"]="1f683549"
  ["raiseDispute(uint256)"]="a5c1674e"
  ["resolveDispute(uint256,uint256)"]="bdc84ac3"
  ["resolveDisputeTimeout(uint256)"]="333edf12"
  ["bookings(uint256)"]="1dab301e"
)

# Check required files.
if [[ ! -f "$SOL_FILE" ]]; then
  echo "ERROR: Contract source not found: $SOL_FILE" >&2
  exit 1
fi

# Compile if the ABI artifact does not exist.
if [[ ! -f "$ARTIFACT_FILE" ]]; then
  echo "Compiled ABI not found. Running Hardhat compile..."

  if [[ ! -f "$BLOCKCHAIN_DIR/package.json" ]]; then
    echo "ERROR: blockchain/package.json not found." >&2
    exit 1
  fi

  (
    cd "$BLOCKCHAIN_DIR"
    npx hardhat compile
  )

  if [[ ! -f "$ARTIFACT_FILE" ]]; then
    echo "ERROR: Hardhat did not produce the expected ABI artifact." >&2
    exit 1
  fi
fi

# Require an actual selector computation tool.
if ! command -v cast >/dev/null 2>&1 &&
   [[ ! -d "$BLOCKCHAIN_DIR/node_modules/ethers" ]]; then
  echo "ERROR: Neither Foundry cast nor ethers is available." >&2
  echo "Install dependencies with npm ci in blockchain/." >&2
  exit 1
fi

# Compute a selector from the canonical function signature.
compute_selector() {
  local sig="$1"

  if command -v cast >/dev/null 2>&1; then
    cast sig "$sig" | sed 's/^0x//' | tr '[:upper:]' '[:lower:]'
  else
    NODE_PATH="$BLOCKCHAIN_DIR/node_modules" \
      node -e '
        const { ethers } = require("ethers");
        const signature = process.argv[1];
        const iface = new ethers.Interface([`function ${signature}`]);
        const fragment = iface.getFunction(signature);
        if (!fragment) {
          throw new Error(`Invalid function signature: ${signature}`);
        }
        console.log(fragment.selector.slice(2).toLowerCase());
      ' "$sig"
  fi
}

# Extract canonical signatures from the compiled contract ABI.
TMP_SIGS="$(mktemp)"
trap 'rm -f "$TMP_SIGS"' EXIT

NODE_PATH="$BLOCKCHAIN_DIR/node_modules" \
  node -e '
    const fs = require("fs");

    const file = process.argv[1];
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!Array.isArray(artifact.abi)) {
      throw new Error("Compiled artifact does not contain a valid ABI.");
    }

    const signatures = new Set();

    for (const item of artifact.abi) {
      if (item.type !== "function") continue;

      const signature = `${item.name}(${item.inputs
        .map((input) => input.type)
        .join(",")})`;

      signatures.add(signature);
    }

    for (const signature of signatures) {
      console.log(signature);
    }
  ' "$ARTIFACT_FILE" > "$TMP_SIGS"

if [[ ! -s "$TMP_SIGS" ]]; then
  echo "ERROR: No function signatures found in compiled ABI." >&2
  exit 1
fi

# Compute selectors from the signatures extracted from the contract.
declare -A ACTUAL_SELECTORS

while IFS= read -r sig; do
  [[ -z "$sig" ]] && continue
  ACTUAL_SELECTORS["$sig"]="$(compute_selector "$sig")"
done < "$TMP_SIGS"

# Compare backend expectations against the compiled ABI.
ERRORS=0

for sig in "${!EXPECTED_SELECTORS[@]}"; do
  expected="${EXPECTED_SELECTORS[$sig]}"
  actual="${ACTUAL_SELECTORS[$sig]:-}"

  if [[ -z "$actual" ]]; then
    echo "FAIL: $sig is missing from the compiled contract."
    ERRORS=$((ERRORS + 1))
  elif [[ "$actual" == "$expected" ]]; then
    echo "PASS: $sig -> 0x$actual"
  else
    echo "FAIL: $sig"
    echo "  Expected: 0x$expected"
    echo "  Actual:   0x$actual"
    ERRORS=$((ERRORS + 1))
  fi
done

echo

if [[ "$ERRORS" -eq 0 ]]; then
  echo "All escrow ABI selectors match."
  exit 0
else
  echo "$ERRORS ABI selector(s) failed verification."
  echo "Do not deploy until the mismatch is resolved."
  exit 1
fi
