/**
 * Regression guard for the duplicated auth/mesh block in WebRTCSignalingServer.
 *
 * origin/main shipped the connection setup twice in the same scope, so
 * `const peerId` and `let meshId` were each declared twice. That is a
 * parse-time SyntaxError: the module cannot be imported at all, which takes
 * down every consumer of it (webrtc.js constructs the server directly) and is
 * why the WebRTC unit suites could not load.
 *
 * The block that must survive is the second one, because it is the only copy
 * that enforces the mesh ceiling. A naive repair that just deletes the second
 * declaration would parse again but silently drop that limit, so these
 * assertions cover both directions.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src/services/webrtc/WebRTCSignalingServer.js');
const source = fs.readFileSync(SRC, 'utf8');

const countMatches = (re) => (source.match(re) ?? []).length;

describe('WebRTCSignalingServer parse integrity', () => {
  it('declares peerId exactly once', () => {
    expect(countMatches(/const\s+peerId\s*=/g)).toBe(1);
  });

  it('declares meshId exactly once', () => {
    expect(countMatches(/let\s+meshId\s*=/g)).toBe(1);
  });

  it('retains the mesh ceiling enforcement in the surviving block', () => {
    // Removing the duplicated block must not delete the size guard.
    expect(source).toMatch(/maximum mesh limit reached/);
    expect(source).toMatch(/this\.meshes\.size\s*>=\s*limit/);
  });

  it('still authenticates before deriving peer identity', () => {
    const authIdx = source.indexOf('verifyAuthToken');
    const peerIdx = source.indexOf('this.generatePeerId()');
    expect(authIdx).toBeGreaterThan(-1);
    expect(peerIdx).toBeGreaterThan(authIdx);
  });

  it('rejects unauthenticated connections before allocating a peer', () => {
    expect(source).toMatch(/ws\.close\(4001,\s*'Invalid token'\)/);
  });
});