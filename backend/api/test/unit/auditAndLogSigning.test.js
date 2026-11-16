import { describe, expect, it } from 'vitest';
import { AUDIT_EVENTS, EVENT_SEVERITY, getEventSeverity } from '../../src/lib/auditEventTypes.js';
import { signLogBatch, verifyLogBatch, generateLogId, redactSensitiveFields } from '../../src/lib/logSigner.js';

describe('auditEventTypes', () => {
  it('event values follow the dotted domain.action convention and are unique', () => {
    const values = Object.values(AUDIT_EVENTS);
    for (const v of values) expect(v).toMatch(/^[a-z_]+\.[a-z_.]+$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it('severity map only references declared events', () => {
    const declared = new Set(Object.values(AUDIT_EVENTS));
    for (const key of Object.keys(EVENT_SEVERITY)) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it('getEventSeverity returns the mapped level and defaults to info', () => {
    expect(getEventSeverity(AUDIT_EVENTS.ESCROW_DISPUTED)).toBe('critical');
    expect(getEventSeverity(AUDIT_EVENTS.AUTH_LOGIN_FAILURE)).toBe('warning');
    expect(getEventSeverity(AUDIT_EVENTS.ORDER_CREATED)).toBe('info');
    expect(getEventSeverity('unknown.event')).toBe('info');
  });
});

describe('logSigner', () => {
  const logs = [
    { id: 'log_1', timestamp: 1000, event_type: 'order.created', user_id: 'u1' },
    { id: 'log_2', timestamp: 2000, event_type: 'bid.placed', user_id: 'u2' },
  ];

  it('sign + verify round-trip', () => {
    const sig = signLogBatch(logs, 'secret-key');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyLogBatch(logs, sig, 'secret-key')).toBe(true);
  });

  it('verification fails on tampering, reordering, or wrong secret', () => {
    const sig = signLogBatch(logs, 'secret-key');
    const tampered = [{ ...logs[0], event_type: 'order.cancelled' }, logs[1]];
    expect(verifyLogBatch(tampered, sig, 'secret-key')).toBe(false);
    expect(verifyLogBatch([logs[1], logs[0]], sig, 'secret-key')).toBe(false);
    expect(verifyLogBatch(logs, sig, 'wrong-key')).toBe(false);
  });

  it('guards empty inputs and malformed signatures without throwing', () => {
    expect(signLogBatch([], 'k')).toBe('');
    expect(signLogBatch(logs, '')).toBe('');
    expect(verifyLogBatch(logs, '', 'k')).toBe(false);
    expect(verifyLogBatch(logs, 'not-hex', 'k')).toBe(false);
    expect(verifyLogBatch(logs, 'aabb', 'k')).toBe(false); // wrong length
  });

  it('generateLogId is unique and sortable-ish (timestamp-prefixed)', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateLogId()));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^log_[0-9a-z]+_[0-9a-f]{12}$/);
  });

  it('redactSensitiveFields hashes PII and leaves the rest intact', () => {
    const out = redactSensitiveFields(
      { name: 'Ram', phone: '9999999999', notes: 'ok' },
      ['phone']
    );
    // the redaction is a truncated sha256 fingerprint (16 hex + '...')
    expect(out.phone).toMatch(/^[0-9a-f]{16}\.\.\.$/);
    expect(out.phone).not.toBe('9999999999');
    // deterministic: same input → same fingerprint
    const again = redactSensitiveFields({ phone: '9999999999' }, ['phone']);
    expect(again.phone).toBe(out.phone);
    expect(out.name).toBe('Ram');
    expect(out.notes).toBe('ok');
  });

  it('redactSensitiveFields is non-mutating and guards non-objects', () => {
    const src = { a: 1 };
    redactSensitiveFields(src, ['a']);
    expect(src.a).toBe(1);
    expect(redactSensitiveFields(null, ['a'])).toBeNull();
    expect(redactSensitiveFields('str', ['a'])).toBe('str');
  });
});
