import WebRTCSignalingServer from '../services/webrtc/WebRTCSignalingServer.js';

let signalingServer = null;

export function initWebRTCSignaling(server) {
  if (!signalingServer) {
    signalingServer = new WebRTCSignalingServer(server);
  }
  return signalingServer;
}

export function getWebRTCSignaling() {
  return signalingServer;
}

export function closeWebRTCSignaling() {
  if (signalingServer) {
    signalingServer.wss.close();
    signalingServer = null;
  }
}