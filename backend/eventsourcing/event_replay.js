import crypto from 'crypto';

/**
 * Computes SHA-256 hash for event payload and chain linkage
 */
function computeEventHash(streamId, sequenceNumber, payload, previousHash) {
    return crypto.createHash('sha256')
        .update(`${streamId}:${sequenceNumber}:${JSON.stringify(payload)}:${previousHash || 'GENESIS'}`)
        .digest('hex');
}

/**
 * Isolated sliding-window ring buffer for an individual event stream
 */
export class StreamBuffer {
    constructor(streamId, maxBufferSize = 250, ttlMs = 1800000) {
        this.streamId = streamId;
        this.maxBufferSize = maxBufferSize;
        this.ttlMs = ttlMs;
        this.events = []; // Ordered by sequenceNumber ascending
        this.sequenceMap = new Map(); // sequenceNumber -> event
        this.lastAccessedAt = Date.now();
        this.highestSequenceSeen = 0;
        this.lowestSequenceRetained = 0;
        this.totalEventsIngested = 0;
        this.totalEvictedEvents = 0;
        this.detectedGapCount = 0;
    }

    /**
     * Pushes an event into the stream buffer, maintaining strictly sorted order
     * and calculating cryptographic hash chain integrity.
     */
    pushEvent(sequenceNumber, payload, customTimestamp = null) {
        const seq = Number(sequenceNumber);
        if (!Number.isInteger(seq) || seq <= 0) {
            throw new Error(`Invalid sequenceNumber ${sequenceNumber}: Must be a positive integer`);
        }

        this.lastAccessedAt = customTimestamp || Date.now();

        // Duplicate sequence check
        if (this.sequenceMap.has(seq)) {
            return {
                status: 'DUPLICATE_IGNORED',
                streamId: this.streamId,
                sequenceNumber: seq
            };
        }

        // Calculate cryptographic hash chaining
        const previousEvent = this.sequenceMap.get(seq - 1);
        const previousHash = previousEvent ? previousEvent.hash : (this.events.length > 0 ? this.events[this.events.length - 1].hash : 'GENESIS');
        const eventHash = computeEventHash(this.streamId, seq, payload, previousHash);

        const eventRecord = {
            sequenceNumber: seq,
            payload,
            previousHash,
            hash: eventHash,
            timestamp: customTimestamp || Date.now()
        };

        // Binary search insertion to keep events sorted ascending
        let low = 0;
        let high = this.events.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (this.events[mid].sequenceNumber < seq) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        this.events.splice(low, 0, eventRecord);
        this.sequenceMap.set(seq, eventRecord);
        this.totalEventsIngested += 1;

        if (seq > this.highestSequenceSeen) {
            // Check if there was a gap between highestSequenceSeen and seq
            if (this.highestSequenceSeen > 0 && seq > this.highestSequenceSeen + 1) {
                this.detectedGapCount += (seq - this.highestSequenceSeen - 1);
            }
            this.highestSequenceSeen = seq;
        }

        // Buffer Capacity & Eviction
        while (this.events.length > this.maxBufferSize) {
            const evicted = this.events.shift();
            this.sequenceMap.delete(evicted.sequenceNumber);
            this.totalEvictedEvents += 1;
        }

        this.lowestSequenceRetained = this.events.length > 0 ? this.events[0].sequenceNumber : 0;

        return {
            status: 'ACCEPTED',
            streamId: this.streamId,
            sequenceNumber: seq,
            hash: eventHash,
            bufferSize: this.events.length
        };
    }

    /**
     * Scans buffer to detect missing sequence numbers in the stream
     */
    detectGaps() {
        this.lastAccessedAt = Date.now();
        const gaps = [];
        if (this.events.length <= 1) return gaps;

        for (let i = 0; i < this.events.length - 1; i++) {
            const currentSeq = this.events[i].sequenceNumber;
            const nextSeq = this.events[i + 1].sequenceNumber;

            if (nextSeq > currentSeq + 1) {
                gaps.push({
                    fromSeq: currentSeq + 1,
                    toSeq: nextSeq - 1,
                    missingCount: nextSeq - currentSeq - 1
                });
            }
        }
        return gaps;
    }

    /**
     * Retrieves missed events starting from `startSeq`.
     * Explicitly signals BUFFER_OVERRUN if requested sequence has been evicted.
     */
    getMissedEvents(startSeq, maxCount = 100) {
        this.lastAccessedAt = Date.now();
        const seq = Number(startSeq);

        if (this.events.length === 0) {
            return {
                status: 'EMPTY_BUFFER',
                streamId: this.streamId,
                startSeq: seq,
                events: [],
                requiresFullSnapshot: false,
                gaps: []
            };
        }

        // Overrun check: Caller requested older events than our retained window
        if (seq < this.lowestSequenceRetained) {
            return {
                status: 'BUFFER_OVERRUN',
                streamId: this.streamId,
                requestedSeq: seq,
                lowestRetainedSeq: this.lowestSequenceRetained,
                highestRetainedSeq: this.highestSequenceSeen,
                evictedCount: this.lowestSequenceRetained - seq,
                requiresFullSnapshot: true,
                events: this.events.slice(0, maxCount),
                message: `Events prior to sequence ${this.lowestSequenceRetained} were evicted. Client must request snapshot.`
            };
        }

        // Filter events >= seq up to maxCount
        const matched = [];
        for (const evt of this.events) {
            if (evt.sequenceNumber >= seq) {
                matched.push(evt);
                if (matched.length >= maxCount) break;
            }
        }

        // Detect any gaps within the matched window
        const windowGaps = [];
        for (let i = 0; i < matched.length - 1; i++) {
            if (matched[i + 1].sequenceNumber > matched[i].sequenceNumber + 1) {
                windowGaps.push({
                    fromSeq: matched[i].sequenceNumber + 1,
                    toSeq: matched[i + 1].sequenceNumber - 1,
                    missingCount: matched[i + 1].sequenceNumber - matched[i].sequenceNumber - 1
                });
            }
        }

        return {
            status: 'OK',
            streamId: this.streamId,
            startSeq: seq,
            count: matched.length,
            events: matched,
            hasGaps: windowGaps.length > 0,
            gaps: windowGaps,
            requiresFullSnapshot: false
        };
    }

    /**
     * Checks if this stream buffer has expired its inactivity TTL
     */
    isExpired(now = Date.now()) {
        return (now - this.lastAccessedAt) > this.ttlMs;
    }

    /**
     * Generates Negative Acknowledgement (NACK) retransmission specifications
     */
    generateNackRequests() {
        const gaps = this.detectGaps();
        return gaps.map(g => ({
            streamId: this.streamId,
            requestType: 'NACK_RETRANSMIT',
            fromSeq: g.fromSeq,
            toSeq: g.toSeq,
            requestedCount: g.missingCount,
            requestedAt: new Date().toISOString()
        }));
    }
}

/**
 * Enterprise Multi-Stream Event Replay Buffer & Gap Detection Engine
 */
export class EventReplayBuffer {
    constructor(maxBufferSize = 250, defaultTtlMs = 1800000) {
        this.maxBufferSize = maxBufferSize;
        this.defaultTtlMs = defaultTtlMs;
        this.buffers = new Map(); // streamId -> StreamBuffer
    }

    /**
     * Gets or lazily creates a StreamBuffer for the given stream identifier
     */
    getOrCreateStream(streamId) {
        if (!streamId || typeof streamId !== 'string') {
            throw new Error('Valid string streamId is required');
        }
        if (!this.buffers.has(streamId)) {
            this.buffers.set(streamId, new StreamBuffer(streamId, this.maxBufferSize, this.defaultTtlMs));
        }
        return this.buffers.get(streamId);
    }

    /**
     * Ingests an event frame for a driver/aggregate stream
     */
    pushEvent(streamId, sequenceNumber, payload, customTimestamp = null) {
        const stream = this.getOrCreateStream(streamId);
        return stream.pushEvent(sequenceNumber, payload, customTimestamp);
    }

    /**
     * Retrieves missed events for subscriber replay
     */
    getMissedEvents(streamId, startSeq, maxCount = 100) {
        if (!this.buffers.has(streamId)) {
            return {
                status: 'STREAM_NOT_FOUND',
                streamId,
                startSeq,
                events: [],
                requiresFullSnapshot: true
            };
        }
        const stream = this.buffers.get(streamId);
        return stream.getMissedEvents(startSeq, maxCount);
    }

    /**
     * Scans stream for packet gaps
     */
    detectGaps(streamId) {
        if (!this.buffers.has(streamId)) return [];
        return this.buffers.get(streamId).detectGaps();
    }

    /**
     * Generates NACK retransmission request specifications for missing sequences
     */
    generateNackRequests(streamId) {
        if (!this.buffers.has(streamId)) return [];
        return this.buffers.get(streamId).generateNackRequests();
    }

    /**
     * Reclaims memory for streams that have exceeded idle TTL
     */
    reclaimInactiveStreams(customTtlMs = null) {
        const now = Date.now();
        const ttl = customTtlMs || this.defaultTtlMs;
        let reclaimedCount = 0;

        for (const [streamId, buffer] of this.buffers.entries()) {
            if ((now - buffer.lastAccessedAt) > ttl) {
                this.buffers.delete(streamId);
                reclaimedCount += 1;
            }
        }

        return {
            reclaimedCount,
            activeStreamsCount: this.buffers.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Retrieves metrics and telemetry for a specific stream
     */
    getStreamMetrics(streamId) {
        if (!this.buffers.has(streamId)) {
            return null;
        }
        const stream = this.buffers.get(streamId);
        return {
            streamId: stream.streamId,
            currentBufferSize: stream.events.length,
            maxBufferSize: stream.maxBufferSize,
            lowestSequenceRetained: stream.lowestSequenceRetained,
            highestSequenceSeen: stream.highestSequenceSeen,
            totalEventsIngested: stream.totalEventsIngested,
            totalEvictedEvents: stream.totalEvictedEvents,
            detectedGapCount: stream.detectedGapCount,
            lastAccessedAt: new Date(stream.lastAccessedAt).toISOString()
        };
    }

    /**
     * Resets all buffer state
     */
    reset() {
        this.buffers.clear();
    }
}

export const eventReplayBuffer = new EventReplayBuffer();
export default eventReplayBuffer;
