#!/usr/bin/env bash
# ============================================================================
# check-escrow-abi.sh
# ============================================================================
# CI guard that verifies the backend (escrow.js) ABI selectors match the
# selectors actually present in the compiled TruxifyEscrow contract.
#
# Usage:
#   bash scripts/check-escrow-abi.sh
#
# This script:
#   1. Reads the compiled contract ABI
#      (blockchain/artifacts/contracts/TruxifyEscrow.sol/TruxifyEscrow.json)
#      produced by `npx hardhat compile`; if it is absent, derives the
#      function signatures from blockchain/contracts/TruxifyEscrow.sol.
#   2. Computes the real selectors with `cast` (foundry) or node + ethers
#      (blockchain/node_modules) — never from the expected strings themselves.
#   3. Compares them with the selectors defined in escrow.js
#   4. Fails (exit 1) on any mismatch or if the selectors cannot be verified.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOL_FILE="$ROOT_DIR/blockchain/contracts/TruxifyEscrow.sol"
ARTIFACT_FILE="$ROOT_DIR/blockchain/artifacts/contracts/TruxifyEscrow.sol/TruxifyEscrow.json"

echo "🔍 Checking escrow ABI compatibility..."

# Expected selectors (from backend/api/src/services/escrow.js ESCROW_ABI)
# These are keccak256(first 4 bytes) of the function signatures.
declare -A EXPECTED_SELECTORS
EXPECTED_SELECTORS["createBooking(uint256,address,bytes)"]="0bb7aa51"
EXPECTED_SELECTORS["lockPayment(uint256,address,address)"]="044e8539"
EXPECTED_SELECTORS["commitmentNonces(address)"]="09135335"
EXPECTED_SELECTORS["releasePayment(uint256)"]="88685cd9"
EXPECTED_SELECTORS["cancelBooking(uint256)"]="0dca825e"
EXPECTED_SELECTORS["cancelWithPenalty(uint256,uint256)"]="ca9a63b1"
EXPECTED_SELECTORS["markBookingStarted(uint256)"]="1f683549"
EXPECTED_SELECTORS["raiseDispute(uint256)"]="a5c1674e"
EXPECTED_SELECTORS["resolveDispute(uint256,uint256)"]="bdc84ac3"
EXPECTED_SELECTORS["resolveDisputeTimeout(uint256)"]="333edf12"
EXPECTED_SELECTORS["bookings(uint256)"]="1dab301e"

if ! command -v cast &>/dev/null && [ ! -d "$ROOT_DIR/blockchain/node_modules/ethers" ]; then
  echo "❌ Neither cast (foundry) nor ethers (blockchain/node_modules) is available to compute selectors." >&2
  echo "   Run 'npm ci' in blockchain/ (or install foundry) and re-run." >&2
  exit 1
fi

# Compute the real selector for a signature using cast or node + ethers.
# Prints the 8-char hex selector (no 0x prefix).
compute_selector() {
  local sig="$1"
  if command -v cast &>/dev/null; then
    cast keccak "$sig" | cut -c1-10 | sed 's/^0x//'
  else
    NODE_PATH="$ROOT_DIR/blockchain/node_modules" node -e "
      const { ethers } = require('ethers');
      const iface = new ethers.Interface(['function $sig']);
      console.log(iface.getFunction('${sig%%(*}').selector.slice(2));
    "
  fi
}

# Extract the signatures exposed by the contract. Reads the compiled ABI when
# available, otherwise parses the .sol source for function declarations and
# public/constant state getters. Prints one signature per line.
extract_signatures() {
  if [ -f "$ARTIFACT_FILE" ]; then
    NODE_PATH="$ROOT_DIR/blockchain/node_modules" node -e '
      const fs = require("fs");
      const artifact = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      const seen = new Set();
      for (const item of artifact.abi || []) {
        if (item.type !== "function") continue;
        const sig = `${item.name}(${(item.inputs || []).map((i) => i.type).join(",")})`;
        if (!seen.has(sig)) { seen.add(sig); console.log(sig); }
      }
    ' node "$ARTIFACT_FILE"
  else
    echo "⚠️  Compiled artifact not found — deriving selectors from $SOL_FILE." >&2
    [ -f "$SOL_FILE" ] || { echo "❌ Contract source not found at $SOL_FILE" >&2; exit 1; }
    NODE_PATH="$ROOT_DIR/blockchain/node_modules" node -e '
      const fs = require("fs");
      const src = fs.readFileSync(process.argv[2], "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const seen = new Set();
      const add = (sig) => { if (!seen.has(sig)) { seen.add(sig); console.log(sig); } };

      // External/public function declarations (skip private/internal helpers).
      const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = fnRe.exec(src)) !== null) {
        const open = src.indexOf("(", m.index);
        let depth = 0;
        let close = -1;
        for (let i = open; i < src.length; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
        }
        if (close === -1) continue;
        const tail = src.slice(close + 1, src.indexOf("{", close));
        if (/\b(private|internal)\b/.test(tail)) continue;

        const params = src.slice(open + 1, close).split(",").map((p) => {
          let s = p.trim().replace(/\b(payable|memory|calldata|storage)\b/g, " ").replace(/\s+/g, " ");
          const words = s.split(" ");
          if (words.length > 1) {
            const last = words[words.length - 1];
            if (/^[a-z_$][\w$]*$/i.test(last)) words.pop();
          }
          return words.join(" ").trim();
        }).filter((p) => p.length > 0);

        add(`${m[1]}(${params.join(",")})`);
      }

      // Public/constant state variables expose getters (e.g. mapping -> key getter).
      const varRe = /(?:mapping\s*\(\s*([A-Za-z_$][\w$]*)\s*=>\s*[^)]*\)|([A-Za-z_$][\w$]*(?:\s*\[\s*\])*))\s+(?:(constant\s+)?public|public\s+constant)\s+([A-Za-z_$][\w$]*)/g;
      let v;
      while ((v = varRe.exec(src)) !== null) {
        add(v[1] ? `${v[4]}(${v[1]})` : `${v[4]}()`);
      }
    ' node "$SOL_FILE"
  fi
}

TMP_SIGS="$(mktemp)"
trap 'rm -f "$TMP_SIGS"' EXIT
extract_signatures > "$TMP_SIGS"

if [ ! -s "$TMP_SIGS" ]; then
  echo "❌ No signatures could be extracted from the contract. Cannot verify ABI selectors." >&2
  exit 1
fi

# Build the map of actual selectors from the contract.
declare -A ACTUAL_SELECTORS
while IFS= read -r sig; do
  [ -z "$sig" ] && continue
  ACTUAL_SELECTORS["$sig"]="$(compute_selector "$sig")"
done < "$TMP_SIGS"

ERRORS=0
for sig in "${!EXPECTED_SELECTORS[@]}"; do
  expected="${EXPECTED_SELECTORS[$sig]}"
  actual="${ACTUAL_SELECTORS[$sig]:-}"
  if [ -z "$actual" ]; then
    echo "  ❌ $sig → not present in the compiled contract"
    ERRORS=$((ERRORS + 1))
  elif [ "$actual" = "$expected" ]; then
    echo "  ✅ $sig → 0x$expected"
  else
    echo "  ❌ $sig → expected 0x$expected, contract has 0x$actual"
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
