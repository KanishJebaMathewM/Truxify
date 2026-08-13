/**
 * Regression tests for GlobalStore transaction rollback / undo snapshots.
 *
 * Covers issue #11496:
 *  - set/update inside a transaction must not pollute undo history
 *  - snapshots must be deep so nested state is restored correctly
 *  - rollback must restore the pre-transaction state and leave the undo
 *    history cursor consistent
 *  - a committed transaction must collapse to a single undo entry
 */

import { describe, it, expect } from 'vitest';
import GlobalStore from '../store/GlobalStore.js';

describe('GlobalStore transaction rollback / undo snapshots (#11496)', () => {
    it('coalesces transaction mutations into a single undo entry', async () => {
        const store = new GlobalStore({ count: 0, nested: { value: 1 } });
        store.saveHistory(); // establish a baseline undo entry

        await store.transaction(async () => {
            store.set('count', 1);
            store.set('count', 2);
            store.update({ nested: { value: 99 } });
        });

        // Only the net transaction effect should have been recorded.
        expect(store.history.length).toBe(2);
        expect(store.historyIndex).toBe(store.history.length - 1);

        // One undo reverts the whole transaction.
        const ok = store.undo();
        expect(ok).toBe(true);
        expect(store.get('count')).toBe(0);
        expect(store.get('nested')).toEqual({ value: 1 });
    });

    it('rollback restores deep (nested) state and leaves undo history intact', async () => {
        const store = new GlobalStore({ profile: { name: 'a', meta: { age: 10 } } });
        store.saveHistory();
        store.set('extra', 1);

        const baselineHistoryLength = store.history.length;
        const baselineIndex = store.historyIndex;

        let rolledBack = false;
        try {
            await store.transaction(async () => {
                store.set('profile', { name: 'b', meta: { age: 20 } });
                throw new Error('boom');
            });
        } catch (err) {
            rolledBack = true;
        }

        expect(rolledBack).toBe(true);

        // State fully restored to the pre-transaction snapshot (deep).
        expect(store.get('profile')).toEqual({ name: 'a', meta: { age: 10 } });

        // The restored state must not be aliased to the baseline history entry.
        expect(store.get('profile')).not.toBe(store.history[baselineIndex].profile);
        expect(store.get('profile').meta).not.toBe(store.history[baselineIndex].profile?.meta);

        // Undo history is untouched by the rolled-back transaction.
        expect(store.history.length).toBe(baselineHistoryLength);
        expect(store.historyIndex).toBe(baselineIndex);
        expect(store.canUndo()).toBe(true);

        // Undo still works back to the pre-transaction baseline state.
        expect(store.undo()).toBe(true);
        expect(store.get('profile')).toEqual({ name: 'a', meta: { age: 10 } });
    });

    it('createSnapshot / restoreSnapshot perform deep copies', () => {
        const store = new GlobalStore({ a: { b: { c: 1 } } });
        const snapshot = store.createSnapshot();

        store.set('a', { b: { c: 2 } });
        store.restoreSnapshot(snapshot);

        expect(store.get('a')).toEqual({ b: { c: 1 } });

        // Mutating the live state must not leak into the captured snapshot.
        store.get('a').b.c = 42;
        expect(snapshot.state.a.b.c).toBe(1);
    });
});
