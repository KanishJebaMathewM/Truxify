/**
 * WebSocket Sequence Divergence Detector & Event Sourced Replay Log
 */
export class DivergenceDetector {
  constructor() {
    this.driverSequences = new Map(); // driverId -> lastSeenSeq
    this.divergenceLogs = [];
  }

  processIncomingFrame(driverId, sequenceNumber, payload) {
    const lastSeq = this.driverSequences.get(driverId) || 0;

    if (sequenceNumber > lastSeq && sequenceNumber !== lastSeq + 1) {
      // Divergence detected (gap in the sequence)
      const divergenceEvent = {
        driverId,
        expectedSeq: lastSeq + 1,
        receivedSeq: sequenceNumber,
        gapSize: sequenceNumber - (lastSeq + 1),
        timestamp: Date.now(),
      };
      this.divergenceLogs.push(divergenceEvent);
      console.warn(`[DivergenceDetector] Gap detected for ${driverId}: expected ${lastSeq + 1}, got ${sequenceNumber}`);
    }

    // Never regress the watermark on out-of-order or duplicate frames
    this.driverSequences.set(driverId, Math.max(lastSeq, sequenceNumber));
    return {
      driverId,
      isDivergent: sequenceNumber !== lastSeq + 1,
      currentSeq: sequenceNumber,
    };
  }

  getDivergenceLogs() {
    return this.divergenceLogs;
  }
}

export const divergenceDetector = new DivergenceDetector();
