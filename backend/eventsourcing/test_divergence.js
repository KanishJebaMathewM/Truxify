import { divergenceDetector } from './divergence_detector.js';
import { eventReplayBuffer } from './event_replay.js';
import { sortBySequence } from './event-store.js';
import assert from 'assert';

console.log('Testing Event-Sourcing Divergence Detector...');

const driverId = 'DRV_TEST_999';

// Frame 1
const res1 = divergenceDetector.processIncomingFrame(driverId, 1, { lat: 28.5, lng: 77.1 });
eventReplayBuffer.pushEvent(driverId, 1, { lat: 28.5, lng: 77.1 });
assert.strictEqual(res1.isDivergent, false);

// Frame 2
const res2 = divergenceDetector.processIncomingFrame(driverId, 2, { lat: 28.6, lng: 77.2 });
eventReplayBuffer.pushEvent(driverId, 2, { lat: 28.6, lng: 77.2 });
assert.strictEqual(res2.isDivergent, false);

// Frame 5 (Gap: skipped 3, 4)
const res5 = divergenceDetector.processIncomingFrame(driverId, 5, { lat: 28.9, lng: 77.5 });
eventReplayBuffer.pushEvent(driverId, 5, { lat: 28.9, lng: 77.5 });
assert.strictEqual(res5.isDivergent, true);

const logs = divergenceDetector.getDivergenceLogs();
assert.strictEqual(logs.length, 1);
// Frames 3 and 4 never arrived, so the gap holds exactly those two frames.
assert.strictEqual(logs[0].gapSize, 2);

console.log('✅ Divergence Detector tests passed successfully.');

// The shared sequencer the replay buffer relies on, exercised here because no
// other runnable suite covers it.
assert.deepStrictEqual(
  sortBySequence([{ sequenceNr: 3 }, { sequenceNr: 1 }]).map((e) => e.sequenceNr),
  [1, 3]
);

