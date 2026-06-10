import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: supportRouter } = await import('../../src/routes/supportRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRouter);
  return app;
}

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

describe('Support Routes', () => {
  beforeEach(() => {
    m.store.faqs = [];
    m.store.support_tickets = [];
    m.calls.length = 0;
  });

  it('GET /faqs returns only active FAQs sorted by sort_order', async () => {
    m.store.faqs.push(
      {
        id: 'faq-2',
        question: 'Second?',
        answer: 'Second answer',
        app_type: 'customer',
        sort_order: 20,
        is_active: true,
      },
      {
        id: 'faq-hidden',
        question: 'Hidden?',
        answer: 'Hidden answer',
        app_type: 'customer',
        sort_order: 5,
        is_active: false,
      },
      {
        id: 'faq-1',
        question: 'First?',
        answer: 'First answer',
        app_type: 'driver',
        sort_order: 10,
        is_active: true,
      }
    );

    const res = await request(buildApp()).get('/api/support/faqs');

    expect(res.status).toBe(200);
    expect(res.body.map(faq => faq.id)).toEqual(['faq-1', 'faq-2']);

    const faqQuery = m.calls.find(c => c.table === 'faqs' && c.mode === 'select');
    expect(faqQuery.filters).toContainEqual({ col: 'is_active', op: 'eq', val: true });
    expect(faqQuery.order).toEqual({ col: 'sort_order', ascending: true });
  });

  it('GET /faqs filters by app_type and includes both-type FAQs when provided', async () => {
    m.store.faqs.push(
      {
        id: 'faq-customer',
        question: 'Customer question?',
        answer: 'Customer answer',
        app_type: 'customer',
        sort_order: 10,
        is_active: true,
      },
      {
        id: 'faq-driver',
        question: 'Driver question?',
        answer: 'Driver answer',
        app_type: 'driver',
        sort_order: 20,
        is_active: true,
      },
      {
        id: 'faq-both',
        question: 'Shared question?',
        answer: 'Shared answer',
        app_type: 'both',
        sort_order: 15,
        is_active: true,
      }
    );

    const res = await request(buildApp()).get('/api/support/faqs?app_type=driver');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map(f => f.id)).toEqual(['faq-both', 'faq-driver']);
  });

  it('POST /tickets requires authenticated headers in auth bypass mode', async () => {
    const res = await request(buildApp())
      .post('/api/support/tickets')
      .send({ subject: 'Need help', category: 'account' });

    expect(res.status).toBe(401);
  });

  it('POST /tickets validates required fields', async () => {
    const res = await request(buildApp())
      .post('/api/support/tickets')
      .set(CUSTOMER_HEADERS)
      .send({ subject: '   ', category: 'billing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('subject and category are required.');
  });

  it('POST /tickets creates an open ticket for the authenticated user with category mapping and description', async () => {
    const res = await request(buildApp())
      .post('/api/support/tickets')
      .set(CUSTOMER_HEADERS)
      .send({
        subject: '  App payment issue  ',
        category: ' billing ',
        description: 'My custom description details'
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Support ticket created successfully.');
    expect(res.body.ticket.status).toBe('open');

    const ticketInsert = m.calls.find(c => c.table === 'support_tickets' && c.mode === 'insert');
    expect(ticketInsert.payload).toEqual({
      user_id: 'customer-1',
      subject: 'App payment issue',
      description: 'My custom description details',
      category: 'payment',
      status: 'open',
    });
  });

  it('POST /tickets defaults description to subject when omitted', async () => {
    const res = await request(buildApp())
      .post('/api/support/tickets')
      .set(CUSTOMER_HEADERS)
      .send({ subject: 'Help needed', category: 'technical' });

    expect(res.status).toBe(201);
    const ticketInsert = m.calls.find(c => c.table === 'support_tickets' && c.mode === 'insert');
    expect(ticketInsert.payload.description).toBe('Help needed');
  });

  it('GET /tickets returns only tickets owned by the authenticated user', async () => {
    m.store.support_tickets.push(
      {
        id: 'ticket-old',
        user_id: 'customer-1',
        subject: 'Old issue',
        category: 'account',
        status: 'closed',
        created_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'ticket-other',
        user_id: 'customer-2',
        subject: 'Other issue',
        category: 'billing',
        status: 'open',
        created_at: '2026-06-03T00:00:00.000Z',
      },
      {
        id: 'ticket-new',
        user_id: 'customer-1',
        subject: 'New issue',
        category: 'billing',
        status: 'open',
        created_at: '2026-06-02T00:00:00.000Z',
      }
    );

    const res = await request(buildApp())
      .get('/api/support/tickets')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.tickets.map(ticket => ticket.id)).toEqual(['ticket-new', 'ticket-old']);

    const ticketQuery = m.calls.find(c => c.table === 'support_tickets' && c.mode === 'select');
    expect(ticketQuery.filters).toContainEqual({ col: 'user_id', op: 'eq', val: 'customer-1' });
    expect(ticketQuery.order).toEqual({ col: 'created_at', ascending: false });
  });
});
