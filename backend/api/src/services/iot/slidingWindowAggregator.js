/**
 * SlidingWindowAggregator: In-Memory Rolling Window Statistics for IoT Telematics
 * 
 * Computes 5-minute statistical windows per active freight trip:
 * - Temperature & Humidity (min, max, mean, variance)
 * - Resultant acceleration & dynamic shock magnitude
 * - Harsh braking / acceleration event counting
 * - Door open durations and breach counts
 */
export class SlidingWindowAggregator {
  /**
   * @param {object} [options={}]
   * @param {number} [options.windowDurationMs=300000] - 5 minutes default
   * @param {number} [options.maxReadingsPerWindow=1000]
   */
  constructor(options = {}) {
    this.windowDurationMs = options.windowDurationMs || 5 * 60 * 1000;
    this.maxReadingsPerWindow = options.maxReadingsPerWindow || 1000;
    this.buffers = new Map(); // tripId -> Array<TelemetryReading>
  }

  /**
   * Ingests a new telemetry reading into the trip's sliding window.
   * 
   * @param {string} tripId
   * @param {object} reading - { temp, humidity, doorOpen, ax, ay, az, timestamp }
   * @returns {object} Aggregated 5-minute window summary
   */
  addReading(tripId, reading) {
    if (!tripId) {
      throw new Error('tripId is required for sliding window aggregation');
    }

    const now = reading.timestamp ? new Date(reading.timestamp).getTime() : Date.now();
    const normalized = {
      temp: Number(reading.temp ?? reading.temperature ?? 0),
      humidity: Number(reading.humidity ?? 0),
      doorOpen: Boolean(reading.doorOpen ?? reading.door_open ?? false),
      ax: Number(reading.ax ?? 0),
      ay: Number(reading.ay ?? 0),
      az: Number(reading.az ?? 9.81),
      timestamp: now,
    };

    // Calculate dynamic acceleration shock: ||a|| - g
    const resultantG = Math.sqrt(normalized.ax ** 2 + normalized.ay ** 2 + normalized.az ** 2);
    normalized.dynamicShock = Math.abs(resultantG - 9.81);

    if (!this.buffers.has(tripId)) {
      this.buffers.set(tripId, []);
    }

    const buffer = this.buffers.get(tripId);
    buffer.push(normalized);

    // Evict readings older than windowDurationMs
    const cutoffTime = now - this.windowDurationMs;
    while (buffer.length > 0 && buffer[0].timestamp < cutoffTime) {
      buffer.shift();
    }

    // Safety cap on buffer length
    if (buffer.length > this.maxReadingsPerWindow) {
      buffer.splice(0, buffer.length - this.maxReadingsPerWindow);
    }

    return this.getSummary(tripId);
  }

  /**
   * Computes statistical summary across current 5-minute window.
   * 
   * @param {string} tripId
   * @returns {object} Summary metrics
   */
  getSummary(tripId) {
    const buffer = this.buffers.get(tripId);
    if (!buffer || buffer.length === 0) {
      return {
        readingCount: 0,
        tempMean: 0,
        tempMin: 0,
        tempMax: 0,
        tempStdDev: 0,
        humidityMean: 0,
        peakShockG: 0,
        harshBrakingCount: 0,
        doorOpenCount: 0,
        doorOpenSeconds: 0,
        windowSpanSeconds: 0,
      };
    }

    let tempSum = 0;
    let tempMin = Infinity;
    let tempMax = -Infinity;
    let humiditySum = 0;
    let peakShock = 0;
    let harshBrakingCount = 0;
    let doorOpenCount = 0;

    for (const r of buffer) {
      tempSum += r.temp;
      if (r.temp < tempMin) tempMin = r.temp;
      if (r.temp > tempMax) tempMax = r.temp;

      humiditySum += r.humidity;

      if (r.dynamicShock > peakShock) {
        peakShock = r.dynamicShock;
      }

      // Harsh braking / shock threshold (dynamic shock >= 4.5 m/s^2)
      if (r.dynamicShock >= 4.5) {
        harshBrakingCount++;
      }

      if (r.doorOpen) {
        doorOpenCount++;
      }
    }

    const n = buffer.length;
    const tempMean = tempSum / n;
    const humidityMean = humiditySum / n;

    // Standard deviation of temperature
    let varianceSum = 0;
    for (const r of buffer) {
      varianceSum += (r.temp - tempMean) ** 2;
    }
    const tempStdDev = Math.sqrt(varianceSum / n);

    const windowSpanMs = buffer[buffer.length - 1].timestamp - buffer[0].timestamp;
    const windowSpanSeconds = Math.round(windowSpanMs / 1000);

    // Approximate door open time in seconds based on reading interval
    const avgIntervalSec = n > 1 ? windowSpanSeconds / (n - 1) : 0;
    const doorOpenSeconds = Math.round(doorOpenCount * avgIntervalSec);

    return {
      readingCount: n,
      tempMean: Number(tempMean.toFixed(2)),
      tempMin: Number(tempMin.toFixed(2)),
      tempMax: Number(tempMax.toFixed(2)),
      tempStdDev: Number(tempStdDev.toFixed(3)),
      humidityMean: Number(humidityMean.toFixed(2)),
      peakShockG: Number((peakShock / 9.81).toFixed(2)),
      peakShockMps2: Number(peakShock.toFixed(2)),
      harshBrakingCount,
      doorOpenCount,
      doorOpenSeconds,
      windowSpanSeconds,
      lastReadingTime: new Date(buffer[buffer.length - 1].timestamp).toISOString(),
    };
  }

  /**
   * Cleans up telemetry buffer for a completed trip.
   * @param {string} tripId
   */
  clearTrip(tripId) {
    this.buffers.delete(tripId);
  }
}

export default SlidingWindowAggregator;
