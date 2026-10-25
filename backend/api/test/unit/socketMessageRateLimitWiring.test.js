/**
 * Source-level wiring assertions.
 *
 * The limiter behaviour itself is covered in socketRateLimiter.test.js. These
 * checks exist to catch the failure mode where a correctly implemented token
 * bucket is simply not consulted by a handler, which unit tests of the helper
 * alone would not detect.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('socket message rate limiting wiring', () => {
  const locationServer = read('sockets/locationServer.js');
  const webrtcServer = read('services/webrtc/WebRTCSignalingServer.js');

  it('location_update is throttled before any telemetry write or broadcast', () => {
    const handlerStart = locationServer.indexOf('socket.on("location_update"');
    expect(handlerStart).toBeGreaterThan(-1);

    // Slice exactly this handler, up to the next registered handler.
    const nextHandler = locationServer.indexOf('socket.on(', handlerStart + 1);
    const handler = locationServer.slice(
      handlerStart,
      nextHandler > handlerStart ? nextHandler : handlerStart + 4000,
    );

    // The gate must be the first thing in the handler...
    const gateIdx = handler.indexOf('locationUpdateLimiter.tryConsume()');
    expect(gateIdx).toBeGreaterThan(-1);

    // ...and must precede both expensive side effects.
    const bufferIdx = handler.indexOf('telemetryBuffer.enqueue');
    const emitIdx = handler.indexOf('driver_location');
    expect(bufferIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(bufferIdx);
    expect(gateIdx).toBeLessThan(emitIdx);

    // Over-rate messages return before touching the shared ring buffer.
    const returnIdx = handler.indexOf('return;', gateIdx);
    expect(returnIdx).toBeGreaterThan(gateIdx);
    expect(returnIdx).toBeLessThan(bufferIdx);
  });

  it('a flooding driver connection is dropped', () => {
    expect(locationServer).toMatch(/isAbusive\(\)/);
    expect(locationServer).toMatch(/socket\.disconnect\(true\)/);
  });

  it('the location limiter is created per connection, not shared globally', () => {
    // Declared inside the connection handler so each socket gets its own budget.
    expect(locationServer).toMatch(
      /driverNs\.on\(["']connection["'][\s\S]{0,2000}createSocketRateLimiter\(/,
    );
    expect(locationServer).toContain('const locationUpdateLimiter = createSocketRateLimiter(');
  });

  it('WebRTC signaling relay is throttled per peer', () => {
    expect(webrtcServer).toContain("ws.on('message'");
    expect(webrtcServer).toMatch(/messageLimiter\.tryConsume\(\)/);

    // The gate must precede parsing/handling.
    const msgIdx = webrtcServer.indexOf("ws.on('message'");
    const handler = webrtcServer.slice(msgIdx, msgIdx + 900);
    const gateIdx = handler.indexOf('messageLimiter.tryConsume()');
    const parseIdx = handler.indexOf('JSON.parse');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(parseIdx);
  });

  it('both servers import the shared limiter helper', () => {
    expect(locationServer).toContain(
      "import { createSocketRateLimiter } from \"../lib/socketRateLimiter.js\";",
    );
    expect(webrtcServer).toContain(
      "import { createSocketRateLimiter } from '../../lib/socketRateLimiter.js';",
    );
  });

  it('the limiter is not defeatable by hostile environment configuration', () => {
    // Env overrides are optional, and garbage falls back to the safe default.
    for (const server of [locationServer, webrtcServer]) {
      expect(server).toMatch(/process\.env\.WS_(LOCATION|WEBRTC)_MSG_RATE_PER_SEC/);
    }
    const helper = read('lib/socketRateLimiter.js');
    expect(helper).toMatch(/Number\.isFinite\(refillPerSecond\)/);
    expect(helper).toMatch(/Number\.isFinite\(capacity\)/);
  });
});