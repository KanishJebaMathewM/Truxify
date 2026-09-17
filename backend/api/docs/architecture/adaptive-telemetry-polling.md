# Adaptive Telemetry Polling Architecture

## Overview
The Truxify WebSocket tracker persists high-frequency GPS pings to MongoDB via a background buffer flusher. Previously, this flusher operated on a fixed `setTimeout` interval (e.g., every 1000ms). Under high load (thousands of concurrent drivers), this fixed interval caused a backlog of pending writes, leading to memory bloat and delayed ETA calculations. Conversely, during low traffic, the fixed interval caused unnecessary database polling (busy-wait).

## The Solution: Adaptive Polling
To resolve Issue #6691, the telemetry monitor now dynamically adjusts its polling interval based on the current **Queue Depth**.

### Algorithm
1. **Queue Depth Measurement**: Before scheduling the next `setTimeout`, the monitor queries the telemetry buffer for its current pending write count.
2. **Threshold Evaluation**:
   - **High Load (`depth > THRESHOLD`)**: The interval is halved (e.g., 1000ms → 500ms) to aggressively drain the backlog.
   - **Low Load (`depth <= THRESHOLD`)**: The interval is doubled (e.g., 1000ms → 2000ms) to reduce DB CPU pressure.
3. **Bounds Checking**: The interval is clamped between `MIN_INTERVAL_MS` (10ms) to prevent CPU spinning, and `MAX_INTERVAL_MS` to ensure eventual consistency.

## Configuration
The behavior can be tuned via environment variables in the `tracker.js` monitor initialization:
- `MONGO_POLL_INTERVAL_MS`: Base interval (default: 1000)
- `MONGO_POLL_QUEUE_THRESHOLD`: Depth trigger for aggressive polling (default: 100)

## Impact
- **Performance**: Eliminates busy-wait CPU spikes during idle hours.
- **Reliability**: Prevents OOM crashes during traffic surges by clearing the write queue faster.
- **Database Health**: Reduces MongoDB IOPS by up to 50% during off-peak hours.
