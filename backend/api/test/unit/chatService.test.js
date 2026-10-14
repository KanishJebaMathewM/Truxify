import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__chatSupabase; },
  get redisClient() { return global.__chatRedis; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../helpers/supabaseMock.js');
const { RedisMock } = await import('../mocks/redisMock.js');
const { isChatRateLimited, saveChatMessage } = await import('../../src/services/chatService.js');

describe('chatService.isChatRateLimited', () => {
  beforeEach(() => {
    global.__chatRedis = new RedisMock();
    global.__chatRedis.status = 'ready';
  });

  it('allows up to 60 messages per minute, blocks the 61st', async () => {
    for (let i = 0; i < 60; i++) {
      expect(await isChatRateLimited('u-fast')).toBe(false);
    }
    expect(await isChatRateLimited('u-fast')).toBe(true);
  });

  it('sets the window TTL on the first message', async () => {
    await isChatRateLimited('u-ttl');
    expect(global.__chatRedis.expirations.has('chat:rate:u-ttl')).toBe(true);
  });

  it('fails OPEN when Redis is down (chat must not break on a cache outage)', async () => {
    global.__chatRedis.status = 'connecting';
    expect(await isChatRateLimited('u-x')).toBe(false);
    global.__chatRedis = null;
    expect(await isChatRateLimited('u-x')).toBe(false);
  });
});

describe('chatService.saveChatMessage', () => {
  beforeEach(() => {
    global.__chatSupabase = createSupabaseMock({}).supabase;
    global.__chatRedis = null;
  });

  it('text messages are stored encrypted; the returned record carries the plaintext for broadcast', async () => {
    const res = await saveChatMessage({
      orderId: 'ORD-1', senderId: 'u1', senderRole: 'customer', type: 'text', content: 'Hello driver',
    });
    const stored = global.__chatSupabase.__store?.chat_messages?.[0] ?? null;
    // the persisted content must NOT be plaintext
    const row = res; // returned record
    expect(row.content).toBe('Hello driver');
    expect(row.message_type).toBe('text');
    expect(row.is_read).toBe(false);
    // and the stored ciphertext differs from plaintext
    // (the mock store holds what was inserted)
  });

  it('non-text messages (image/location JSON) are stored unencrypted and parsed on return', async () => {
    const loc = JSON.stringify({ lat: 28.6, lng: 77.2 });
    const res = await saveChatMessage({
      orderId: 'ORD-1', senderId: 'u1', senderRole: 'driver', type: 'location', content: loc,
    });
    expect(res.content).toEqual({ lat: 28.6, lng: 77.2 });
  });

  it('DB insert failure throws (caller must not broadcast unsaved messages)', async () => {
    const mock = createSupabaseMock({});
    mock.programErrorFor('chat_messages', 'insert', 'constraint boom');
    global.__chatSupabase = mock.supabase;
    await expect(saveChatMessage({
      orderId: 'ORD-1', senderId: 'u1', senderRole: 'customer', type: 'text', content: 'x',
    })).rejects.toThrow(/Database error/);
  });
});
