import assert from 'node:assert';
import {
    translateVoiceTransmission,
    detectEmergencyDistress,
    signVoicePacket,
    verifyVoicePacket,
    CB_CHANNELS,
    EMERGENCY_KEYWORDS,
    SUPPORTED_LANGUAGES,
    COMMON_DISPATCH_TRANSLATIONS
} from '../../src/services/cbTranslator.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running CB Radio Voice Translation & Safety Distress Tests ---');

await test('validates FCC Part 95 channel allocations and frequencies', () => {
    assert.strictEqual(CB_CHANNELS.CHANNEL_09.frequencyMhz, 27.065);
    assert.strictEqual(CB_CHANNELS.CHANNEL_09.restrictedUseOnly, true);
    assert.strictEqual(CB_CHANNELS.CHANNEL_19.frequencyMhz, 27.185);
    assert.strictEqual(CB_CHANNELS.CHANNEL_19.restrictedUseOnly, false);
});

await test('detects emergency distress keywords and triggers immediate preemptive priority', () => {
    const mayday = detectEmergencyDistress('Mayday mayday, severe jackknife on I-80 mile marker 142');
    assert.strictEqual(mayday.isEmergency, true);
    assert.strictEqual(mayday.severity, 'CRITICAL');
    assert.ok(mayday.matchedKeywords.includes('mayday'));
    assert.ok(mayday.matchedKeywords.includes('jackknife'));
    assert.strictEqual(mayday.broadcastPriority, 'IMMEDIATE_PREEMPTIVE');

    const routine = detectEmergencyDistress('Proceeding to staging bay 3 for check-in');
    assert.strictEqual(routine.isEmergency, false);
    assert.strictEqual(routine.severity, 'ROUTINE');
    assert.strictEqual(routine.broadcastPriority, 'NORMAL');
});

await test('automatically assigns emergency priority to Channel 9 transmissions', () => {
    const ch9Check = detectEmergencyDistress('Driver requesting road assistance', 'CHANNEL_09');
    assert.strictEqual(ch9Check.isEmergency, true);
    assert.strictEqual(ch9Check.emergencyOverride, true);
});

await test('translates dispatch phrases accurately into Spanish, Punjabi, and Hindi', () => {
    const es = translateVoiceTransmission({
        transcriptText: 'caution icy bridge ahead',
        targetLanguage: 'ES'
    });
    assert.strictEqual(es.target.translatedTranscript, 'Precaución puente helado adelante');

    const pa = translateVoiceTransmission({
        transcriptText: 'proceed to dock door 14',
        targetLanguage: 'PA'
    });
    assert.strictEqual(pa.target.translatedTranscript, "ਡੌਕ ਡੋਰ 14 'ਤੇ ਜਾਓ");

    const hi = translateVoiceTransmission({
        transcriptText: 'turn off engine during loading',
        targetLanguage: 'HI'
    });
    assert.strictEqual(hi.target.translatedTranscript, 'लोडिंग के दौरान इंजन बंद करें');
});

await test('reduces processing latency to 45ms when emergency distress is detected', () => {
    const emergencyPacket = translateVoiceTransmission({
        transcriptText: 'Emergency! Brake failure descending steep grade!',
        targetLanguage: 'ES'
    });

    assert.strictEqual(emergencyPacket.safety.isEmergency, true);
    assert.strictEqual(emergencyPacket.latencyMs, 45); // Accelerated low-latency audio delivery
});

await test('creates HMAC-SHA256 signature and verifies authentic voice packets', () => {
    const packet = translateVoiceTransmission({
        channelId: 'CHANNEL_19',
        senderId: 'DISPATCHER_42',
        transcriptText: 'Scale house is open ahead',
        targetLanguage: 'ES'
    });

    assert.ok(packet.signature);
    assert.strictEqual(packet.signature.length, 64);

    const verification = verifyVoicePacket(packet, packet.signature);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.reason, null);
});

await test('rejects tampered voice packet with altered transcript text', () => {
    const packet = translateVoiceTransmission({
        channelId: 'CHANNEL_19',
        senderId: 'DISPATCHER_42',
        transcriptText: 'All clear on northbound corridor',
        targetLanguage: 'ES'
    });

    // Attacker modifies audio transcript to falsely claim road closed
    const tamperedPacket = {
        ...packet,
        source: {
            ...packet.source,
            originalTranscript: 'Road closed, detour immediately'
        }
    };

    const verification = verifyVoicePacket(tamperedPacket, packet.signature);
    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.reason, 'Cryptographic signature mismatch');
});

await test('preserves backward compatibility of translateVoiceTransmission defaults', () => {
    const defaultPacket = translateVoiceTransmission({});
    assert.strictEqual(defaultPacket.channelId, 'CHANNEL_09_DISPATCH');
    assert.strictEqual(defaultPacket.senderId, 'DISPATCH_MGR_01');
    assert.strictEqual(defaultPacket.source.language, 'English');
    assert.strictEqual(defaultPacket.target.language, 'Spanish');
});

console.log('\n🎉 All CB Radio Voice Translation & Safety Distress tests passed successfully!\n');
