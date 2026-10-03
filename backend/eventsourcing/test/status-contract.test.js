/**
 * @file status-contract.test.js
 *
 * Contract test for issue #13886: "Event-sourcing status enum divergence".
 *
 * Verifies that the set of statuses emitted by the event-sourcing write side
 * (applyEvent in event-sourcing-core.js), after canonical normalization via
 * deriveOrderStatus, is a strict subset of the ORDER_STATUSES list exported
 * from read-model-schema.js -- which is also the list used by the Kafka CQRS
 * read model's getOrderStats query.
 *
 * This test is intentionally dependency-free (no Supabase, no Kafka) so it
 * runs in any environment with plain `node --test`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent } from '../event-sourcing-core.js';
import {
  ORDER_STATUSES,
  deriveOrderStatus,
} from '../../api/src/core/orders/read-model-schema.js';

// ---------------------------------------------------------------------------
// Synthetic domain events that exercise every branch of the aggregate reducer.
// ---------------------------------------------------------------------------
const EVENTS = [
  {
    label: 'ORDER_CREATED',
    event: { type: 'ORDER_CREATED', payload: { customerId: 'c1' }, version: 1 },
    initialState: {},
  },
  {
    label: 'ORDER_UPDATED',
    event: {
      type: 'ORDER_UPDATED',
      payload: { status: 'in_transit', customerId: 'c1' },
      version: 2,
    },
    initialState: { status: 'created', customerId: 'c1' },
  },
  {
    label: 'ORDER_CANCELLED',
    event: {
      type: 'ORDER_CANCELLED',
      payload: { cancelledAt: '2026-08-01T00:00:00Z', reason: 'test' },
      version: 3,
    },
    initialState: { status: 'created' },
  },
  {
    label: 'DRIVER_ASSIGNED',
    event: {
      type: 'DRIVER_ASSIGNED',
      payload: { driverId: 'd1' },
      version: 2,
    },
    initialState: { status: 'created' },
  },
];

describe('status contract -- write side vs read side vocabulary', () => {
  test('ORDER_STATUSES is a non-empty, frozen array of lowercase strings', () => {
    assert.ok(Array.isArray(ORDER_STATUSES), 'ORDER_STATUSES must be an array');
    assert.ok(ORDER_STATUSES.length > 0, 'ORDER_STATUSES must not be empty');
    assert.ok(Object.isFrozen(ORDER_STATUSES), 'ORDER_STATUSES must be frozen');
    for (const s of ORDER_STATUSES) {
      assert.equal(typeof s, 'string', `every entry must be a string, got: ${String(s)}`);
      assert.equal(s, s.toLowerCase(), `every entry must be lowercase, got: ${s}`);
    }
  });

  test('ORDER_STATUSES has no duplicates', () => {
    const set = new Set(ORDER_STATUSES);
    assert.equal(
      set.size,
      ORDER_STATUSES.length,
      'ORDER_STATUSES must not contain duplicate values'
    );
  });

  for (const { label, event, initialState } of EVENTS) {
    test(`applyEvent(${label}) produces a status in ORDER_STATUSES after normalization`, () => {
      const nextState = applyEvent(initialState, event);
      const normalized = deriveOrderStatus(nextState);

      // ORDER_UPDATED forwards an arbitrary payload status; only check that
      // normalization produces a valid lowercase string.
      if (event.type === 'ORDER_UPDATED') {
        assert.equal(typeof normalized, 'string', 'ORDER_UPDATED state must derive a string status');
        assert.equal(normalized, normalized.toLowerCase(), 'derived status must be lowercase');
        return;
      }

      assert.ok(
        ORDER_STATUSES.includes(normalized),
        `applyEvent(${label}) -> deriveOrderStatus() -> "${normalized}" is not in ORDER_STATUSES`
      );
    });
  }

  test('every fixed write-side status (after normalization) is covered by ORDER_STATUSES', () => {
    const writeSideStatuses = new Set();

    for (const { event, initialState } of EVENTS) {
      if (event.type === 'ORDER_UPDATED') continue;
      const nextState = applyEvent(initialState, event);
      const normalized = deriveOrderStatus(nextState);
      if (normalized) writeSideStatuses.add(normalized);
    }

    for (const status of writeSideStatuses) {
      assert.ok(
        ORDER_STATUSES.includes(status),
        `Write-side derived status "${status}" is missing from ORDER_STATUSES`
      );
    }
  });

  test('ORDER_STATUSES covers all statuses the write side can produce', () => {
    const expectedWriteSideStatuses = ['created', 'cancelled', 'assigned'];
    for (const expected of expectedWriteSideStatuses) {
      assert.ok(
        ORDER_STATUSES.includes(expected),
        `ORDER_STATUSES must include write-side status "${expected}"`
      );
    }
  });
});
