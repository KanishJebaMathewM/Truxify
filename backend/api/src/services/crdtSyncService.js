/**
 * @fileoverview Backend CRDT Delta Synchronization & Conflict Resolution Engine.
 * 
 * Responsibilities:
 * 1. Implements Last-Write-Wins (LWW) Delta-CRDT state merging using Hybrid Logical Clocks (HLC).
 * 2. Enforces at-most-once mutation semantics using idempotency keys.
 * 3. Resolves concurrent multi-device state updates deterministically.
 * 4. Generates incremental delta diffs for client pull requests.
 */

import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';

// In-memory canonical CRDT state store & processed idempotency registry
const crdtEntityStore = new Map(); // compositeKey -> { value, hlc, isDeleted, updatedAt }
const processedIdempotencyKeys = new Set();
let serverLogicalCounter = 0;

/**
 * Parses and compares two Hybrid Logical Clock strings: `<millis>:<counter>:<nodeId>`.
 * Returns 1 if hlcA > hlcB, -1 if hlcA < hlcB, 0 if equal.
 */
export function compareHlc(hlcA, hlcB) {
  if (!hlcA && !hlcB) return 0;
  if (!hlcA) return -1;
  if (!hlcB) return 1;

  const [millisA, counterA, nodeA] = hlcA.split(':');
  const [millisB, counterB, nodeB] = hlcB.split(':');

  const mA = Number(millisA) || 0;
  const mB = Number(millisB) || 0;
  if (mA !== mB) return mA > mB ? 1 : -1;

  const cA = Number(counterA) || 0;
  const cB = Number(counterB) || 0;
  if (cA !== cB) return cA > cB ? 1 : -1;

  if (nodeA !== nodeB) return (nodeA || '').localeCompare(nodeB || '');
  return 0;
}

/**
 * Generates an advanced server Hybrid Logical Clock string.
 */
export function generateServerHlc(clientHlcStr = null) {
  const now = Date.now();
  let maxMillis = now;

  if (clientHlcStr) {
    const [cMillis] = clientHlcStr.split(':');
    const clientMillis = Number(cMillis) || 0;
    maxMillis = Math.max(now, clientMillis);
  }

  serverLogicalCounter += 1;
  return `${maxMillis}:${serverLogicalCounter}:server_node_01`;
}

/**
 * Merges a batch of incoming client mutations using LWW-CRDT rules.
 * 
 * @param {Array<Object>} mutations - Array of CrdtMutation objects
 * @param {string} clientClockStr - Client's current HLC string
 * @returns {Object} Resolution result, count of accepted vs duplicate mutations, and server clock
 */
export async function mergeClientMutations(mutations, clientClockStr) {
  if (!Array.isArray(mutations)) {
    throw new DomainError(400, { error: 'mutations must be an array' });
  }

  let appliedCount = 0;
  let deduplicatedCount = 0;
  let overriddenCount = 0;

  for (const mut of mutations) {
    const { entityType, entityId, fieldKey, value, hlc, idempotencyKey, isDeleted = false } = mut;

    if (!entityType || !entityId || !fieldKey || !hlc) {
      continue;
    }

    // 1. Idempotency Check
    if (idempotencyKey && processedIdempotencyKeys.has(idempotencyKey)) {
      deduplicatedCount++;
      continue;
    }

    const compositeKey = `${entityType}:${entityId}:${fieldKey}`;
    const existingEntry = crdtEntityStore.get(compositeKey);

    // 2. LWW-CRDT Arbitration
    if (!existingEntry || compareHlc(hlc, existingEntry.hlc) > 0) {
      crdtEntityStore.set(compositeKey, {
        entityType,
        entityId,
        fieldKey,
        value,
        hlc,
        isDeleted: Boolean(isDeleted),
        updatedAt: new Date().toISOString(),
      });
      appliedCount++;
    } else {
      overriddenCount++;
    }

    if (idempotencyKey) {
      processedIdempotencyKeys.add(idempotencyKey);
    }
  }

  const serverClock = generateServerHlc(clientClockStr);

  logger.info(
    { total: mutations.length, appliedCount, deduplicatedCount, overriddenCount },
    '[crdtSyncService] Client mutations merged'
  );

  return {
    success: true,
    appliedCount,
    deduplicatedCount,
    overriddenCount,
    serverClock,
  };
}

/**
 * Returns all entity deltas updated after the client's last known HLC timestamp.
 */
export function getDeltasSince(sinceHlcStr = null, entityTypeFilter = null) {
  const deltas = [];

  for (const [compositeKey, entry] of crdtEntityStore.entries()) {
    if (entityTypeFilter && entry.entityType !== entityTypeFilter) {
      continue;
    }

    if (!sinceHlcStr || compareHlc(entry.hlc, sinceHlcStr) > 0) {
      deltas.push({
        compositeKey,
        ...entry,
      });
    }
  }

  return deltas;
}

/**
 * Retrieves the full resolved state of an entity.
 */
export function getEntityState(entityType, entityId) {
  const prefix = `${entityType}:${entityId}:`;
  const fields = {};

  for (const [key, entry] of crdtEntityStore.entries()) {
    if (key.startsWith(prefix) && !entry.isDeleted) {
      fields[entry.fieldKey] = entry.value;
    }
  }

  return fields;
}

export default {
  compareHlc,
  generateServerHlc,
  mergeClientMutations,
  getDeltasSince,
  getEntityState,
};
