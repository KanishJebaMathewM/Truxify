import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import { EventReplayBuffer, StreamBuffer, eventReplayBuffer } from '../event_replay.js';

describe('Resilient Event Replay Buffer & Gap Detection Engine', () => {
    beforeEach(() => {
        eventReplayBuffer.reset();
    });

    it('should insert and replay events in sequential order', () => {
        const streamId = 'STREAM-FLEET-01';
        for (let seq = 1; seq <= 5; seq++) {
            const res = eventReplayBuffer.pushEvent(streamId, seq, { speedMph: 50 + seq, lat: 41.8, lon: -87.6 });
            assert.strictEqual(res.status, 'ACCEPTED');
            assert.strictEqual(res.sequenceNumber, seq);
            assert.ok(res.hash.length === 64);
        }

        const missed = eventReplayBuffer.getMissedEvents(streamId, 3);
        assert.strictEqual(missed.status, 'OK');
        assert.strictEqual(missed.count, 3);
        assert.strictEqual(missed.events[0].sequenceNumber, 3);
        assert.strictEqual(missed.events[1].sequenceNumber, 4);
        assert.strictEqual(missed.events[2].sequenceNumber, 5);
        assert.strictEqual(missed.hasGaps, false);
    });

    it('should resequence out-of-order arrivals into strictly sorted order', () => {
        const streamId = 'STREAM-OUT-OF-ORDER';
        const arrivalOrder = [5, 2, 4, 1, 3];

        for (const seq of arrivalOrder) {
            eventReplayBuffer.pushEvent(streamId, seq, { step: `Step_${seq}` });
        }

        const replay = eventReplayBuffer.getMissedEvents(streamId, 1);
        assert.strictEqual(replay.count, 5);

        const seqNumbers = replay.events.map(e => e.sequenceNumber);
        assert.deepStrictEqual(seqNumbers, [1, 2, 3, 4, 5]);
        assert.strictEqual(replay.hasGaps, false);
    });

    it('should ignore duplicate sequence numbers idempotently', () => {
        const streamId = 'STREAM-DUP';
        const first = eventReplayBuffer.pushEvent(streamId, 10, { data: 'first' });
        assert.strictEqual(first.status, 'ACCEPTED');

        const duplicate = eventReplayBuffer.pushEvent(streamId, 10, { data: 'duplicate' });
        assert.strictEqual(duplicate.status, 'DUPLICATE_IGNORED');

        const metrics = eventReplayBuffer.getStreamMetrics(streamId);
        assert.strictEqual(metrics.totalEventsIngested, 1);
    });

    it('should detect sequence gaps and generate precise NACK retransmission requests', () => {
        const streamId = 'STREAM-GAP';
        // Ingest packets 1, 2, 3, then jump to 8, 9, 10
        eventReplayBuffer.pushEvent(streamId, 1, { data: 'A' });
        eventReplayBuffer.pushEvent(streamId, 2, { data: 'B' });
        eventReplayBuffer.pushEvent(streamId, 3, { data: 'C' });
        eventReplayBuffer.pushEvent(streamId, 8, { data: 'D' });
        eventReplayBuffer.pushEvent(streamId, 9, { data: 'E' });
        eventReplayBuffer.pushEvent(streamId, 10, { data: 'F' });

        const gaps = eventReplayBuffer.detectGaps(streamId);
        assert.strictEqual(gaps.length, 1);
        assert.strictEqual(gaps[0].fromSeq, 4);
        assert.strictEqual(gaps[0].toSeq, 7);
        assert.strictEqual(gaps[0].missingCount, 4);

        const nacks = eventReplayBuffer.generateNackRequests(streamId);
        assert.strictEqual(nacks.length, 1);
        assert.strictEqual(nacks[0].requestType, 'NACK_RETRANSMIT');
        assert.strictEqual(nacks[0].fromSeq, 4);
        assert.strictEqual(nacks[0].toSeq, 7);
        assert.strictEqual(nacks[0].requestedCount, 4);
    });

    it('should handle buffer eviction and signal BUFFER_OVERRUN when history is lost', () => {
        const smallBuffer = new EventReplayBuffer(5); // Capacity 5
        const streamId = 'STREAM-OVERRUN';

        // Ingest sequences 1 to 10
        for (let seq = 1; seq <= 10; seq++) {
            smallBuffer.pushEvent(streamId, seq, { val: seq });
        }

        const metrics = smallBuffer.getStreamMetrics(streamId);
        assert.strictEqual(metrics.currentBufferSize, 5);
        assert.strictEqual(metrics.lowestSequenceRetained, 6);
        assert.strictEqual(metrics.highestSequenceSeen, 10);
        assert.strictEqual(metrics.totalEvictedEvents, 5);

        // Requesting seq 8 is within retained window [6..10]
        const validMissed = smallBuffer.getMissedEvents(streamId, 8);
        assert.strictEqual(validMissed.status, 'OK');
        assert.strictEqual(validMissed.count, 3); // 8, 9, 10

        // Requesting seq 2 (which was evicted) MUST signal BUFFER_OVERRUN and require snapshot!
        const overrun = smallBuffer.getMissedEvents(streamId, 2);
        assert.strictEqual(overrun.status, 'BUFFER_OVERRUN');
        assert.strictEqual(overrun.requiresFullSnapshot, true);
        assert.strictEqual(overrun.evictedCount, 4); // 6 - 2 = 4
        assert.strictEqual(overrun.lowestRetainedSeq, 6);
    });

    it('should verify cryptographic SHA-256 hash chaining across consecutive events', () => {
        const streamId = 'STREAM-HASH-CHAIN';
        eventReplayBuffer.pushEvent(streamId, 1, { action: 'IGNITION_ON' });
        eventReplayBuffer.pushEvent(streamId, 2, { action: 'TRIP_STARTED' });
        eventReplayBuffer.pushEvent(streamId, 3, { action: 'SPEED_ACCEL' });

        const replay = eventReplayBuffer.getMissedEvents(streamId, 1);
        const [e1, e2, e3] = replay.events;

        assert.strictEqual(e1.previousHash, 'GENESIS');
        assert.strictEqual(e2.previousHash, e1.hash);
        assert.strictEqual(e3.previousHash, e2.hash);
    });

    it('should reclaim memory by purging inactive stream buffers beyond TTL', () => {
        const customBuffer = new EventReplayBuffer(100, 50); // 50ms TTL
        customBuffer.pushEvent('ACTIVE_STREAM', 1, { data: 'active' });
        customBuffer.pushEvent('STALE_STREAM', 1, { data: 'stale' }, Date.now() - 100); // 100ms ago

        // Reclaim with 50ms threshold
        const result = customBuffer.reclaimInactiveStreams(50);
        assert.strictEqual(result.reclaimedCount, 1);
        assert.strictEqual(result.activeStreamsCount, 1);
        assert.strictEqual(customBuffer.getStreamMetrics('STALE_STREAM'), null);
        assert.ok(customBuffer.getStreamMetrics('ACTIVE_STREAM') !== null);
    });

    it('should isolate multiple streams completely without cross-stream collision', () => {
        eventReplayBuffer.pushEvent('DRIVER_01', 1, { driver: 'Alice' });
        eventReplayBuffer.pushEvent('DRIVER_02', 1, { driver: 'Bob' });

        const d1 = eventReplayBuffer.getMissedEvents('DRIVER_01', 1);
        const d2 = eventReplayBuffer.getMissedEvents('DRIVER_02', 1);

        assert.strictEqual(d1.events[0].payload.driver, 'Alice');
        assert.strictEqual(d2.events[0].payload.driver, 'Bob');
    });
});
