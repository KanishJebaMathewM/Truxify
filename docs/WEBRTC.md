# WebRTC Signaling

## Overview

The Truxify backend provides WebRTC signaling for real-time driver-customer communication (`services/webrtc/WebRTCSignalingServer.js` + `sockets/webrtc.js`).

---

## Location

```
backend/api/src/services/webrtc/WebRTCSignalingServer.js — signaling server
backend/api/src/sockets/webrtc.js                        — singleton facade
```

---

## Behavior

- `initWebRTCSignaling(server)` creates a single WebSocket-based signaling server per process (idempotent — repeated calls return the existing instance).
- Clients exchange SDP offers/answers and ICE candidates through the signaling channel so a peer-to-peer media connection can be established.
- `closeWebRTCSignaling()` destroys the server and resets the singleton (safe on shutdown/test teardown).
- Payload limits are enforced (`WS_MAX_PAYLOAD_BYTES`).

---

## Why It Exists

WebRTC needs a signaling channel to negotiate media; the backend relays the negotiation without touching the media itself, keeping bandwidth off the API servers.

---

## Testing

Automated tests verify:

- Singleton init/get/close lifecycle.
- Signaling message handling (WebRTCSignalingServer tests).
- Shutdown cleanup.
