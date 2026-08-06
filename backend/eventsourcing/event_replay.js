/**
 * Atomic Event Replay Buffer for WebSocket recovery
 */
export class EventReplayBuffer {
  constructor(maxBufferSize = 100) {
    this.maxBufferSize = maxBufferSize;
    this.buffers = new Map(); // driverId -> Array of frames
  }

  pushEvent(driverId, sequenceNumber, payload) {
    if (!this.buffers.has(driverId)) {
      this.buffers.set(driverId, []);
    }
    const buf = this.buffers.get(driverId);
    buf.push({ sequenceNumber, payload, timestamp: Date.now() });

    if (buf.length > this.maxBufferSize) {
      buf.shift();
    }
  }

  getMissedEvents(driverId, startSeq) {
    const buf = this.buffers.get(driverId) || [];
    return buf.filter((evt) => evt.sequenceNumber >= startSeq);
  }
}

export const eventReplayBuffer = new EventReplayBuffer();
