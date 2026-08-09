import { webRtcVoiceAiServer } from './webrtc_server.js';
import assert from 'assert';

console.log('Testing WebRTC Voice AI Server...');

const connId = 'CONN_VOICE_101';
const mockOffer = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 0.0.0.0\r\n' };

const answer = webRtcVoiceAiServer.handleOfferSdp(connId, mockOffer);
assert.strictEqual(answer.type, 'answer');

const audioResult = webRtcVoiceAiServer.processAudioChunk(connId, Buffer.from([0, 1, 2, 3]));
assert.strictEqual(audioResult.transcribedText, "Where is my shipment?");
assert.strictEqual(audioResult.latencyMs < 300, true);

console.log('✅ WebRTC Voice AI tests passed successfully.');
