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

  it('GET /tickets rejects unsupported status filter values', async () => {
    const res = await request(buildApp())
      .get('/api/support/tickets?status=unknown')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unsupported support ticket status.');
  });

  describe('GET /tickets/:id', () => {
    beforeEach(() => {
      m.store.support_tickets.push({
        id: 'ticke33333333-3333-4333-8333-333333333333',
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
        .get('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ticke33333333-3333-4333-8333-333333333333');
      expect(res.body.user_id).toBe('customer-1');
    });

    it('returns 200 and the ticket for an admin', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ticke33333333-3333-4333-8333-333333333333');
    });

    it('returns 403 for an authenticated user who is not the owner', async () => {
      const res = await request(buildApp())
        .get('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
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
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        description: 'Detail',
        category: 'general',
        status: 'open',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
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
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
        .set(CUSTOMER_HEADERS)
        .send({ status: 'closed' });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe('closed');
    });

    it('denies owner from changing status to in_progress or resolved', async () => {
      m.store.support_tickets.push({
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
        .set(CUSTOMER_HEADERS)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access Denied: Only admins can change ticket status.');
    });

    it('allows admin to change status to in_progress or resolved', async () => {
      m.store.support_tickets.push({
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
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
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'closed',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
        .set(CUSTOMER_HEADERS)
        .send({ subject: 'New subject' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot update a closed ticket.');
    });

    it('returns 403 for non-owner and non-admin', async () => {
      m.store.support_tickets.push({
        id: 'ticke33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'My ticket',
        status: 'open',
      });

      const res = await request(buildApp())
        .patch('/api/support/tickets/ticke33333333-3333-4333-8333-333333333333')
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
        { id: 't1', user_id: '11111111-1111-4111-8111-111111111111', subject: 'S1', category: 'payment', status: 'open', created_at: '2026-06-03T00:00:00.000Z' },
        { id: 't2', user_id: '22222222-2222-4222-8222-222222222222', subject: 'S2', category: 'order', status: 'in_progress', created_at: '2026-06-02T00:00:00.000Z' },
        { id: 't3', user_id: '11111111-1111-4111-8111-111111111111', subject: 'S3', category: 'technical', status: 'closed', created_at: '2026-06-01T00:00:00.000Z' }
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
        .get('/api/support/admin/tickets?status=open&category=payment&user_id=11111111-1111-4111-8111-111111111111')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0].id).toBe('t1');
    });

    it('rejects malformed user_id filter values', async () => {
      const res = await request(buildApp())
        .get('/api/support/admin/tickets?user_id=customer-1')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('user_id must be a valid UUID');
    });

    it('rejects unsupported status filter values', async () => {
      const res = await request(buildApp())
        .get('/api/support/admin/tickets?status=waiting')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Unsupported support ticket status.');
    });
  });

  describe('Support Ticket Comments', () => {
    beforeEach(() => {
      m.store.support_ticket_comments = [];
      m.store.support_tickets = [{
        id: '33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        subject: 'Need help',
        category: 'general',
        status: 'open',
      }];
    });

    it('POST /tickets/:id/comments adds a comment for ticket owner', async () => {
      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set(CUSTOMER_HEADERS)
        .send({ message: 'This is a test comment' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Comment added successfully.');
      expect(res.body.comment.message).toBe('This is a test comment');
      expect(res.body.comment.ticket_id).toBe('33333333-3333-4333-8333-333333333333');

      const commentInsert = m.calls.find(c => c.table === 'support_ticket_comments' && c.mode === 'insert');
      expect(commentInsert).toBeTruthy();
      expect(commentInsert.payload.message).toBe('This is a test comment');
    });

    it('POST /tickets/:id/comments returns 403 for non-owner', async () => {
      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set({
          'x-user-id': 'customer-2',
          'x-user-role': 'customer',
          'x-user-name': 'Stranger',
        })
        .send({ message: 'Nice ticket' });

      expect(res.status).toBe(403);
    });

    it('POST /tickets/:id/comments returns 409 when ticket is closed (owner)', async () => {
      m.store.support_tickets[0].status = 'closed';

      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set(CUSTOMER_HEADERS)
        .send({ message: 'New comment after closure' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot comment on a closed ticket.');

      const commentInsert = m.calls.find(c => c.table === 'support_ticket_comments' && c.mode === 'insert');
      expect(commentInsert).toBeUndefined();
    });

    it('POST /tickets/:id/comments returns 409 when ticket is closed (admin)', async () => {
      m.store.support_tickets[0].status = 'closed';

      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set({
          'x-user-id': 'admin-1',
          'x-user-role': 'admin',
          'x-user-name': 'Test Admin',
        })
        .send({ message: 'Admin note on closed ticket' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot comment on a closed ticket.');

      const commentInsert = m.calls.find(c => c.table === 'support_ticket_comments' && c.mode === 'insert');
      expect(commentInsert).toBeUndefined();
    });

    it('POST /tickets/:id/comments still accepts comments on open tickets', async () => {
      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set(CUSTOMER_HEADERS)
        .send({ message: 'Still open, commenting fine' });

      expect(res.status).toBe(201);
      expect(res.body.comment.message).toBe('Still open, commenting fine');
    });

    it('POST /tickets/:id/comments still accepts comments on in_progress tickets', async () => {
      m.store.support_tickets[0].status = 'in_progress';

      const res = await request(buildApp())
        .post('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set(CUSTOMER_HEADERS)
        .send({ message: 'In progress comment' });

      expect(res.status).toBe(201);
      expect(res.body.comment.message).toBe('In progress comment');
    });

    it('GET /tickets/:id/comments retrieves comments for ticket owner', async () => {
      m.store.support_ticket_comments.push({
        id: 'c-1',
        ticket_id: '33333333-3333-4333-8333-333333333333',
        user_id: 'customer-1',
        message: 'Hello',
        created_at: '2026-06-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .get('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].message).toBe('Hello');
    });

    it('GET /tickets/:id/comments supports sort=desc for descending chronological sorting', async () => {
      m.store.support_ticket_comments.push(
        { id: 'c-1', ticket_id: '33333333-3333-4333-8333-333333333333', user_id: 'customer-1', message: 'First', created_at: '2026-06-01T00:00:00.000Z' },
        { id: 'c-2', ticket_id: '33333333-3333-4333-8333-333333333333', user_id: 'customer-1', message: 'Second', created_at: '2026-06-02T00:00:00.000Z' }
      );

      const res = await request(buildApp())
        .get('/api/support/tickets/33333333-3333-4333-8333-333333333333/comments?sort=desc')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].message).toBe('Second');
    });

    it('POST /tickets/:id/comments returns 404 for commenting on non-existent ticket', async () => {
      const res = await request(buildApp())
        .post('/api/support/tickets/non-existent-ticket-id/comments')
        .set(CUSTOMER_HEADERS)
        .send({ message: 'Hello' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Support ticket not found');
    });
  });

  describe('GET /api/support/categories', () => {
    it('returns 200 with categories array and labels map - no auth required', async () => {
      const res = await request(buildApp())
        .get('/api/support/categories');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories).toContain('payment');
      expect(res.body.categories).toContain('order');
      expect(res.body.categories).toContain('technical');
      expect(res.body.categories).toContain('general');
      expect(res.body.categories).toContain('account');
      expect(res.body.labels).toBeDefined();
      expect(typeof res.body.labels.payment).toBe('string');
      expect(res.body.sla_hours).toBeDefined();
      expect(res.body.sla_hours.payment).toBe(24);
      expect(res.body.descriptions).toBeDefined();
      expect(res.body.descriptions.payment).toContain('billing');
    });

    it('categories array contains no duplicates', async () => {
      const res = await request(buildApp())
        .get('/api/support/categories');

      expect(res.status).toBe(200);
      const unique = [...new Set(res.body.categories)];
      expect(res.body.categories).toHaveLength(unique.length);
    });

    it('each category in the array has a corresponding label', async () => {
      const res = await request(buildApp())
        .get('/api/support/categories');

      expect(res.status).toBe(200);
      for (const cat of res.body.categories) {
        expect(res.body.labels[cat]).toBeDefined();
      }
    });

    it('each category in the array has a corresponding description', async () => {
      const res = await request(buildApp())
        .get('/api/support/categories');

      expect(res.status).toBe(200);
      for (const cat of res.body.categories) {
        expect(res.body.descriptions[cat]).toBeDefined();
      }
    });
  });
});
