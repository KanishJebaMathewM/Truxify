import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import axios from 'axios';
import { audioCache, processVoiceQuery } from '../../src/services/voiceService.js';

const mocks = vi.hoisted(() => ({ from: vi.fn(), userId: '' }));
vi.mock('../../src/config/db.js', () => ({ supabase: null, supabaseAdmin: { from: mocks.from } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, _res, next) => { req.user = { id: mocks.userId }; next(); } }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
const { default: router } = await import('../../src/routes/voiceRoutes.js');
const app = express();
app.use(express.json());
app.use('/api/voice', router);
const owner = '11111111-2222-4333-8444-555555555555';
const driver = '22222222-3333-4444-8555-666666666666';
const other = '33333333-4444-4555-8666-777777777777';
const olderId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const latestId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const display = '#FF20261005ABCDEFGHIJKL';
let pg;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE orders (id uuid PRIMARY KEY, order_display_id text UNIQUE, customer_id uuid, driver_id uuid, status text, created_at timestamptz)');
  await pg.query('INSERT INTO orders VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$3,$4,$9,$10),($11,$12,$13,$13,$5,$10)',
    [olderId, display, owner, driver, 'delivered', '2026-10-05', latestId, '#FF20261006ABCDEFGHIJKL', 'in_transit', '2026-10-06', 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa', '#FF20261006PRIVATEORDER', other]);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  mocks.userId = owner;
  audioCache.clear();
  mocks.from.mockImplementation(table => {
    expect(table).toBe('orders');
    let filter = null;
    let user;
    let newest = false;
    let limit = false;
    const query = {
      select: () => query,
      eq(column, value) { expect(['id','order_display_id']).toContain(column); filter = { column, value }; return query; },
      or(expression) {
        const match = /^customer_id\.eq\.([^,]+),driver_id\.eq\.([^,]+)$/.exec(expression);
        expect(match).not.toBeNull();
        expect(match[1]).toBe(match[2]);
        user = match[1]; return query;
      },
      order(column, options) { expect(column).toBe('created_at'); newest = options.ascending === false; return query; },
      limit(count) { expect(count).toBe(1); limit = true; return query; },
      async maybeSingle() {
        const values = [user];
        let sql = 'SELECT * FROM orders WHERE (customer_id = $1 OR driver_id = $1)';
        if (filter) { sql += ` AND ${filter.column} = $2`; values.push(filter.value); }
        if (newest) sql += ' ORDER BY created_at DESC';
        if (limit) sql += ' LIMIT 1';
        const result = await pg.query(sql, values);
        return { data: result.rows[0] || null, error: null };
      },
    };
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); audioCache.clear(); });

async function query(userId, identifier) {
  return processVoiceQuery(userId, identifier, null, 'query.wav', 'Where is my shipment?');
}

describe('voice query order selection with PostgreSQL', () => {
  it('answers for the requested older display ID instead of the latest order', async () => {
    const result = await query(owner, display);
    expect(result.response_text).toContain(display);
    expect(result.response_text).toContain('delivered');
  });
  it('resolves the requested display ID for its assigned driver', async () => {
    expect((await query(driver, display)).response_text).toContain(display);
  });
  it('does not substitute the latest order when the display ID is unknown', async () => {
    expect((await query(owner, '#FF20261006UNKNOWNORDER')).response_text).toContain('your order');
  });
  it('does not substitute another owned order for an unauthorized display ID', async () => {
    const result = await query(owner, '#FF20261006PRIVATEORDER');
    expect(result.response_text).toContain('your order');
    expect(result.response_text).not.toContain('#FF');
  });
  it('preserves UUID lookup for an older order', async () => {
    expect((await query(owner, olderId)).response_text).toContain(display);
  });
  it('preserves context-free queries without looking up an order', async () => {
    expect((await query(owner, null)).response_text).toContain('your order');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('uses the requested display ID in the mounted text-query endpoint', async () => {
    const response = await request(app).post('/api/voice/query').send({ bookingId: display, text: 'Where is my shipment?' });
    expect(response.status).toBe(200);
    expect(response.body.response_text).toContain(display);
  });
  it('passes only the requested order into the provider prompt', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-provider-key');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-tts-key');
    axios.post.mockResolvedValueOnce({ data: { text: 'Where is my shipment?' } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'Requested order response' } }] } })
      .mockResolvedValueOnce({ data: Buffer.from('test-audio') });
    await processVoiceQuery(owner, display, Buffer.from('test-input'), 'query.wav');
    const prompt = axios.post.mock.calls[1][1].messages[0].content;
    expect(prompt).toContain(display);
    expect(prompt).not.toContain(latestId);
  });
});
