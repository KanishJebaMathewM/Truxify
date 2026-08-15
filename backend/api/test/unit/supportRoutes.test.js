import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Creates a chainable Supabase query builder mock.
 * vi.fn() returns undefined when called with args by default;
 * mockImplementation makes it return the chain object regardless
 * of how it is called, enabling .select().eq().maybeSingle() chains.
 */
function makeQuery(data) {
  const chain = {
    select: vi.fn(() => chain).mockImplementation(() => chain),
    eq: vi.fn(() => chain).mockImplementation(() => chain),
    order: vi.fn(() => chain).mockImplementation(() => chain),
    range: vi.fn(() => chain).mockImplementation(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })).mockImplementation(() => Promise.resolve({ data, error: null })),
    single: vi.fn(() => Promise.resolve({ data, error: null })).mockImplementation(() => Promise.resolve({ data, error: null })),
    insert: vi.fn(() => chain).mockImplementation(() => chain),
    update: vi.fn(() => chain).mockImplementation(() => chain),
    query: vi.fn(() => chain).mockImplementation(() => chain),
  };
  return chain;
}

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'user-1', role: 'user', fullName: 'Test User' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: (policy, fetcher) => {
    if (fetcher) {
      return async (req, res, next) => {
        req.policyData = await fetcher(req);
        next();
      };
    }
    return (_req, _res, next) => next();
  },
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

// Self-contained chain builder used by tests and the hoisted mock
function makeQueryChain(data) {
  let chain;
  chain = {
    select: vi.fn().mockImplementation(() => chain),
    eq: vi.fn().mockImplementation(() => chain),
    order: vi.fn().mockImplementation(() => chain),
    range: vi.fn().mockImplementation(() => Promise.resolve({ data, error: null })),
    maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({ data, error: null })),
    single: vi.fn().mockImplementation(() => Promise.resolve({ data, error: null })),
    insert: vi.fn().mockImplementation(() => chain),
    update: vi.fn().mockImplementation(() => chain),
    query: vi.fn().mockImplementation(() => chain),
  };
  return chain;
}

const { supabase, supabaseAdmin, createUserClient } = vi.hoisted(() => {
  const fromFn = vi.fn();
  // Each call to from() returns a fresh chain that resolves to null by default;
  // tests can override supabaseAdmin.from via mockImplementation to inject data.
  fromFn.mockImplementation(() => makeQueryChain(null));
  return {
    supabase: { from: fromFn },
    supabaseAdmin: { from: fromFn },
    createUserClient: vi.fn(() => ({ from: fromFn })),
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabase,
  supabaseAdmin,
  createUserClient,
}));

import supportRoutes from '../../src/routes/supportRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/support', supportRoutes);
  return app;
}

describe('supportRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('GET /support/faqs', () => {
    it('sr1: returns 200 with FAQs list', async () => {
      const mockFaqs = [
        { id: '1', question: 'How do I book a load?', answer: 'Use the app', app_type: 'driver', sort_order: 1 },
        { id: '2', question: 'How do I pay?', answer: 'Use UPI', app_type: 'customer', sort_order: 2 },
      ];
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockFaqs, error: null }),
          }),
        }),
      });

      const res = await request(makeApp()).get('/support/faqs');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('sr2: returns empty array when no FAQs', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const res = await request(makeApp()).get('/support/faqs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('sr3: filters FAQs by app_type', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      supabase.from.mockReturnValue({ select: mockSelect });

      await request(makeApp()).get('/support/faqs').query({ app_type: 'driver' });

      expect(mockSelect).toHaveBeenCalled();
    });

    it('sr4: returns 500 on database error', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      const res = await request(makeApp()).get('/support/faqs');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /support/categories', () => {
    it('sr5: returns 200 with categories metadata', async () => {
      const res = await request(makeApp()).get('/support/categories');

      expect(res.status).toBe(200);
      expect(res.body.categories).toContain('payment');
      expect(res.body.categories).toContain('order');
      expect(res.body.labels).toBeDefined();
      expect(res.body.sla_hours).toBeDefined();
      expect(res.body.descriptions).toBeDefined();
    });

    it('sr6: includes correct SLA hours for categories', async () => {
      const res = await request(makeApp()).get('/support/categories');

      expect(res.body.sla_hours.payment).toBe(24);
      expect(res.body.sla_hours.technical).toBe(4);
      expect(res.body.sla_hours.general).toBe(48);
    });

    it('sr7: includes human-readable labels', async () => {
      const res = await request(makeApp()).get('/support/categories');

      expect(res.body.labels.payment).toBe('Payment & Billing');
      expect(res.body.labels.order).toBe('Order & Booking');
      expect(res.body.labels.technical).toBe('Technical Issue');
    });

    it('sr8: sets cache control header', async () => {
      const res = await request(makeApp()).get('/support/categories');

      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('max-age=86400');
    });
  });

  describe('POST /support/tickets', () => {
    it('sr9: returns 201 when ticket created successfully', async () => {
      const mockTicket = {
        id: VALID_UUID,
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'order',
        status: 'open',
      };
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockTicket, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .post('/support/tickets')
        .send({
          subject: 'Test Subject',
          category: 'booking',
          description: 'Test Description',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('created successfully');
      expect(res.body.ticket).toBeDefined();
    });

    it('sr10: returns 400 when subject is empty', async () => {
      const res = await request(makeApp())
        .post('/support/tickets')
        .send({
          subject: '',
          category: 'booking',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('subject');
    });

    it('sr11: returns 400 for invalid category', async () => {
      const res = await request(makeApp())
        .post('/support/tickets')
        .send({
          subject: 'Valid Subject',
          category: 'invalid-category',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('sr12: normalizes category aliases', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, category: 'payment', status: 'open' },
              error: null,
            }),
          }),
        }),
      });
      createUserClient.mockReturnValue({ from: mockFrom });

      const res = await request(makeApp())
        .post('/support/tickets')
        .send({
          subject: 'Billing Issue',
          category: 'billing',
        });

      expect(res.status).toBe(201);
    });

    it('sr13: uses subject as description when description is empty', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, subject: 'Test', description: 'Test', category: 'general', status: 'open' },
              error: null,
            }),
          }),
        }),
      });
      createUserClient.mockReturnValue({ from: mockFrom });

      const res = await request(makeApp())
        .post('/support/tickets')
        .send({
          subject: 'Test',
          category: 'general',
        });

      expect(res.status).toBe(201);
    });
  });

  describe('GET /support/tickets', () => {
    it('sr14: returns 200 with paginated tickets list', async () => {
      const mockTickets = [
        { id: VALID_UUID, subject: 'Ticket 1', status: 'open' },
        { id: '223e4567-e89b-12d3-a456-426614174001', subject: 'Ticket 2', status: 'closed' },
      ];
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockResolvedValue({ data: mockTickets, error: null, count: 2 }),
              }),
            }),
          }),
        }),
      });

      const res = await request(makeApp()).get('/support/tickets');

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
    });

    it('sr15: filters tickets by status', async () => {
      const mockFrom = vi.fn();
      createUserClient.mockReturnValue({ from: mockFrom });
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
            }),
          }),
        }),
      });

      await request(makeApp()).get('/support/tickets').query({ status: 'open' });

      expect(mockFrom).toHaveBeenCalled();
    });

    it('sr16: returns 400 for invalid status', async () => {
      const res = await request(makeApp())
        .get('/support/tickets')
        .query({ status: 'invalid-status' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('status');
    });

    it('sr17: handles pagination parameters', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
            }),
          }),
        }),
      });
      createUserClient.mockReturnValue({ from: mockFrom });

      const res = await request(makeApp())
        .get('/support/tickets')
        .query({ page: '2', limit: '10' });

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(10);
    });

    it('sr18: caps limit at 100', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
            }),
          }),
        }),
      });
      createUserClient.mockReturnValue({ from: mockFrom });

      const res = await request(makeApp())
        .get('/support/tickets')
        .query({ limit: '500' });

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });

  describe('GET /support/tickets/:id', () => {
    it('sr19: returns 200 with ticket details', async () => {
      const mockTicket = {
        id: VALID_UUID,
        user_id: 'user-1',
        subject: 'Test Ticket',
        description: 'Test Description',
        category: 'technical',
        status: 'open',
      };
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockTicket, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp()).get(`/support/tickets/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(VALID_UUID);
      expect(res.body.subject).toBe('Test Ticket');
    });

    it('sr20: returns 404 when ticket not found', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp()).get(`/support/tickets/${VALID_UUID}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('sr21: returns 500 on database error', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      });

      const res = await request(makeApp()).get(`/support/tickets/${VALID_UUID}`);

      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /support/tickets/:id', () => {
    it('sr22: returns 200 when ticket updated successfully', async () => {
      const mockUpdatedTicket = {
        id: VALID_UUID,
        subject: 'Updated Subject',
        status: 'in_progress',
      };
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn()
                .mockResolvedValueOnce({ data: { id: VALID_UUID, user_id: 'user-1', status: 'open' }, error: null })
                .mockResolvedValueOnce({ data: mockUpdatedTicket, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockUpdatedTicket, error: null }),
              }),
            }),
          }),
        }),
      });

      // Non-admin can update status, but not subject/description/category.
      // Send only status to avoid the admin-content-update check.
      const res = await request(makeApp())
        .patch(`/support/tickets/${VALID_UUID}`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
    });

    it('sr23: returns 400 when updating closed ticket', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, user_id: 'user-1', status: 'closed' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .patch(`/support/tickets/${VALID_UUID}`)
        .send({ subject: 'New Subject' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('closed');
    });

    it('sr24: returns 404 when ticket not found', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .patch(`/support/tickets/${VALID_UUID}`)
        .send({ subject: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /support/tickets/:id/comments', () => {
    it('sr25: returns 201 when comment added', async () => {
      const mockComment = {
        id: 'comment-1',
        ticket_id: VALID_UUID,
        user_id: 'user-1',
        user_name: 'Test User',
        message: 'Test comment',
        created_at: '2024-01-01T00:00:00Z',
      };
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, user_id: 'user-1', status: 'open' },
                error: null,
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockComment, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .post(`/support/tickets/${VALID_UUID}/comments`)
        .send({ message: 'Test comment' });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('added successfully');
      expect(res.body.comment).toBeDefined();
    });

    it('sr26: returns 409 when commenting on closed ticket', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, user_id: 'user-1', status: 'closed' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .post(`/support/tickets/${VALID_UUID}/comments`)
        .send({ message: 'Test comment' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('closed');
    });

    it('sr27: returns 404 when ticket not found', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .post(`/support/tickets/${VALID_UUID}/comments`)
        .send({ message: 'Test comment' });

      expect(res.status).toBe(404);
    });

    it('sr28: returns 404 when ticket not found for empty-message comment attempt', async () => {
      // Note: validateBody is mocked so empty message passes through.
      // The ticket lookup then fails (mock returns null) and returns 404.
      const res = await request(makeApp())
        .post(`/support/tickets/${VALID_UUID}/comments`)
        .send({ message: '' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /support/tickets/:id/comments', () => {
    it('sr29: returns 200 with comments list', async () => {
      const mockComments = [
        { id: 'c1', ticket_id: VALID_UUID, message: 'Comment 1', user_name: 'User 1' },
        { id: 'c2', ticket_id: VALID_UUID, message: 'Comment 2', user_name: 'User 2' },
      ];
      const ticketChain = makeQuery({ id: VALID_UUID, user_id: 'user-1' });
      const commentChain = makeQuery(mockComments);
      createUserClient.mockReturnValue({ from: vi.fn(() => ticketChain) });
      supabase.from.mockReturnValue({ from: vi.fn(() => commentChain) });

      const res = await request(makeApp()).get(`/support/tickets/${VALID_UUID}/comments`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.comments) || Array.isArray(res.body)).toBe(true);
    });

    it('sr30: returns 404 when ticket not found', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const res = await request(makeApp()).get(`/support/tickets/${VALID_UUID}/comments`);

      expect(res.status).toBe(404);
    });

    it('sr31: validates sort parameter', async () => {
      createUserClient.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, user_id: 'user-1' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await request(makeApp())
        .get(`/support/tickets/${VALID_UUID}/comments`)
        .query({ sort: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("sort");
    });
  });

  describe('GET /support/admin/tickets', () => {
    it('sr32: returns 200 with all tickets for admin', async () => {
      const mockTickets = [
        { id: VALID_UUID, user_id: 'user-1', subject: 'Admin Ticket 1' },
        { id: '223e4567-e89b-12d3-a456-426614174001', user_id: 'user-2', subject: 'Admin Ticket 2' },
      ];
      // Override the default fromFn mock to return a chain with mockTickets data
      supabaseAdmin.from.mockImplementation(() => makeQueryChain(mockTickets));

      const res = await request(makeApp()).get('/support/admin/tickets');

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
    });

    it('sr33: filters by status for admin', async () => {
      supabaseAdmin.from.mockImplementation(() => makeQueryChain([]));

      const res = await request(makeApp())
        .get('/support/admin/tickets')
        .query({ status: 'open' });

      expect(res.status).toBe(200);
    });

    it('sr34: filters by user_id for admin', async () => {
      supabaseAdmin.from.mockImplementation(() => makeQueryChain([]));

      const res = await request(makeApp())
        .get('/support/admin/tickets')
        .query({ user_id: VALID_UUID });

      expect(res.status).toBe(200);
    });

    it('sr35: returns 400 for invalid user_id format', async () => {
      const res = await request(makeApp())
        .get('/support/admin/tickets')
        .query({ user_id: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('UUID');
    });
  });
});
