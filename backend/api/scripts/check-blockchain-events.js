/**
 * Verifies that every event watched by the blockchain monitor is declared or
 * emitted by at least one Solidity contract under blockchain/contracts/.
 *
 * Run from the repo root:  node backend/api/scripts/check-blockchain-events.js
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..', '..');

const monitorPath = resolve(repoRoot, 'backend/api/src/services/blockchain/blockchainMonitor.js');
const monitorSource = readFileSync(monitorPath, 'utf8');

const watchedNames = [...monitorSource.matchAll(/event\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);

function collectSolFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSolFiles(full));
    } else if (full.endsWith('.sol')) {
      files.push(full);
    }
  }
  return files;
}

const contractsDir = resolve(repoRoot, 'blockchain/contracts');
const contractSources = collectSolFiles(contractsDir).map((file) => readFileSync(file, 'utf8'));

const missing = watchedNames.filter(
  (name) => !contractSources.some((source) => new RegExp(`\\b${name}\\b`).test(source)),
);

if (missing.length > 0) {
  console.error(
    '[check-blockchain-events] The monitor watches events that no contract in blockchain/contracts/ declares or emits:',
  );
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
  process.exit(1);
}

console.log(
  `[check-blockchain-events] OK: ${watchedNames.length} watched events all exist in blockchain/contracts/.`,
);
