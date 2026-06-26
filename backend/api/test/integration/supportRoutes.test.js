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
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'subject', message: 'Subject is required' }),
      ])
    );
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

  it('GET /tickets with pagination and filtering', async () => {
    m.store.support_tickets.push(
      { id: 't1', user_id: 'customer-1', subject: 'billing 1', category: 'payment', status: 'open', created_at: '2026-06-05T00:00:00.000Z' },
      { id: 't2', user_id: 'customer-1', subject: 'billing 2', category: 'payment', status: 'open', created_at: '2026-06-04T00:00:00.000Z' },
      { id: 't3', user_id: 'customer-1', subject: 'tech 1', category: 'technical', status: 'closed', created_at: '2026-06-03T00:00:00.000Z' }
    );

    // Get page 2 with limit 1, filtered by status=open
    const res = await request(buildApp())
      .get('/api/support/tickets?status=open&page=2&limit=1')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].id).toBe('t2'); // t1 is page 1, t2 is page 2
    expect(res.body.pagination).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  describe('GET /tickets/:id', () => {
    beforeEach(() => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        category: 'general',
        status: 'open',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      });
    });

    it('returns 200 and the ticket for the owner', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/ticket-123')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ticket-123');
      expect(res.body.user_id).toBe('customer-1');
    });

    it('returns 200 and the ticket for an admin', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/ticket-123')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ticket-123');
    });

    it('returns 403 for an authenticated user who is not the owner', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/ticket-123')
        .set({
          'x-user-id': 'customer-2',
          'x-user-role': 'customer',
          'x-user-name': 'Stranger Customer',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access Denied: You do not own this ticket.');
    });

    it('returns 404 for a non-existent ticket', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/non-existent')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Support ticket not found.');
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('allows owner to update subject, description, and category', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        description: 'Detail',
        category: 'general',
        status: 'open',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set(CUSTOMER_HEADERS)
        .send({
          subject: 'New subject',
          description: 'New desc',
          category: 'billing',
        });

      expect(res.status).toBe(200);
      expect(res.body.ticket.subject).toBe('New subject');
      expect(res.body.ticket.description).toBe('New desc');
      expect(res.body.ticket.category).toBe('payment'); // billing maps to payment
    });

    it('allows owner to change status to closed', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set(CUSTOMER_HEADERS)
        .send({ status: 'closed' });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe('closed');
    });

    it('denies owner from changing status to in_progress or resolved', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set(CUSTOMER_HEADERS)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access Denied: Only admins can change ticket status.');
    });

    it('allows admin to change status to in_progress or resolved', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        })
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe('in_progress');
    });

    it('returns 400 when attempting to update a closed ticket', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'closed',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set(CUSTOMER_HEADERS)
        .send({ subject: 'New subject' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot update a closed ticket.');
    });

    it('returns 403 for non-owner and non-admin', async () => {
      m.store.support_tickets.push({
        id: 'ticket-123',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticket-123')
        .set({
          'x-user-id': 'customer-2',
          'x-user-role': 'customer',
          'x-user-name': 'Stranger Customer',
        })
        .send({ subject: 'New subject' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access Denied: You do not own this ticket.');
    });
  });

  describe('GET /admin/tickets', () => {
    beforeEach(() => {
      m.store.support_tickets.push(
        { id: 't1', user_id: 'customer-1', subject: 'S1', category: 'payment', status: 'open', created_at: '2026-06-03T00:00:00.000Z' },
        { id: 't2', user_id: 'customer-2', subject: 'S2', category: 'order', status: 'in_progress', created_at: '2026-06-02T00:00:00.000Z' },
        { id: 't3', user_id: 'customer-1', subject: 'S3', category: 'technical', status: 'closed', created_at: '2026-06-01T00:00:00.000Z' }
      );
    });

    it('returns 403 for non-admin user', async () => {
      const res = await request(buildApp())
        .get('/api/support/admin/tickets')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(403);
    });

    it('allows admin to list all tickets with pagination and sorting', async () => {
      const res = await request(buildApp())
        .get('/api/support/admin/tickets?page=1&limit=2')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(2);
      expect(res.body.tickets[0].id).toBe('t1'); // descending order
      expect(res.body.tickets[1].id).toBe('t2');
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('filters by status, category, and user_id', async () => {
      const res = await request(buildApp())
        .get('/api/support/admin/tickets?status=open&category=payment&user_id=customer-1')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0].id).toBe('t1');
    });
  });
});
