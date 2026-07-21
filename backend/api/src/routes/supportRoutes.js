/**
 * @openapi
 * components:
 *   schemas:
 *     FAQ:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         question:
 *           type: string
 *         answer:
 *           type: string
 *         app_type:
 *           type: string
 *         sort_order:
 *           type: integer
 *     SupportCategoriesResponse:
 *       type: object
 *       properties:
 *         categories:
 *           type: array
 *           items:
 *             type: string
 *         labels:
 *           type: object
 *         sla_hours:
 *           type: object
 *         descriptions:
 *           type: object
 *     CreateTicketRequest:
 *       type: object
 *       required:
 *         - subject
 *         - category
 *       properties:
 *         subject:
 *           type: string
 *         category:
 *           type: string
 *           enum: [billing, booking, payment, order, technical, general, account]
 *         description:
 *           type: string
 *     TicketResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         ticket:
 *           type: object
 *     TicketListResponse:
 *       type: object
 *       properties:
 *         tickets:
 *           type: array
 *           items:
 *             type: object
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             totalPages:
 *               type: integer
 *     UpdateTicketRequest:
 *       type: object
 *       properties:
 *         subject:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *         status:
 *           type: string
 *     CreateCommentRequest:
 *       type: object
 *       required:
 *         - message
 *       properties:
 *         message:
 *           type: string
 *     CommentResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         comment:
 *           type: object
 */

import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import logger from '../middleware/logger.js';
import { createTicketSchema, updateTicketSchema, createTicketCommentSchema, paramIdSchema, uuidParamSchema } from '../validation/requestSchemas.js';

const router = express.Router();


const FAQ_COLUMNS = 'id, question, answer, app_type, sort_order';
const TICKET_COLUMNS = 'id, subject, description, category, status, created_at, updated_at';
const TICKET_DETAIL_COLUMNS = 'id, user_id, subject, description, category, status, created_at, updated_at';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

// Canonical map of all accepted category aliases -> database values.
// Shared by ticket creation, ticket update, and the categories endpoint.
const CATEGORY_MAP = {
  billing: 'payment',
  booking: 'order',
  payment: 'payment',
  order: 'order',
  technical: 'technical',
  general: 'general',
  account: 'account',
};

function normalizeRequiredText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value, fallback, field) {
  if (value === undefined) return { value: fallback };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return { error: `${field} must be a positive integer` };
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) {
    return { error: `${field} must be a positive integer` };
  }

  return { value: parsed };
}

function parseIntegerQuery(value, fallback, field, options = {}) {
  if (value === undefined) return { value: fallback };
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    return { error: `${field} must be an integer` };
  }

  const parsed = Number.parseInt(value, 10);
  if (options.min !== undefined && parsed < options.min) {
    return { error: `${field} must be at least ${options.min}` };
  }

  return { value: parsed };
}

function parseUuidQuery(value, field) {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    return { error: `${field} must be a valid UUID` };
  }
  return { value };
}

function parseTicketStatus(value) {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string') {
    return { error: 'status must be a single value' };
  }
  const normalized = value.toLowerCase().trim();
  if (!VALID_TICKET_STATUSES.includes(normalized)) {
    return { error: 'Unsupported support ticket status.' };
  }
  return { value: normalized };
}

// ============================================================================
// 1. LIST ACTIVE FAQS (PUBLIC)
// ============================================================================
/**
 * @openapi
 * /api/support/faqs:
 *   get:
 *     tags: [Support]
 *     summary: List active FAQs
 *     description: Returns active FAQs optionally filtered by app type. Public endpoint - no authentication required.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: app_type
 *         schema:
 *           type: string
 *         description: Filter by app type (customer, driver, both)
 *     responses:
 *       200:
 *         description: Array of FAQs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/FAQ'
 */
router.get('/faqs', async (req, res) => {
  const appType = normalizeRequiredText(req.query.app_type);

  try {
    let query = supabase
      .from('faqs')
      .select(FAQ_COLUMNS)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (appType) {
      query = query.in('app_type', [appType, 'both']);
    }

    const { data: faqs, error } = await query;

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch FAQs.',
        details: error.message,
      });
    }

    res.json(faqs || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 2. LIST VALID TICKET CATEGORIES (PUBLIC)
// ============================================================================
/**
 * @openapi
 * /api/support/categories:
 *   get:
 *     tags: [Support]
 *     summary: List support ticket categories
 *     description: Returns valid support ticket categories with human-readable labels, SLA response times in hours, and descriptions. Public endpoint - no authentication required. Cached for 24 hours.
 *     security: []
 *     responses:
 *       200:
 *         description: Categories with metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SupportCategoriesResponse'
 */
const VALID_CATEGORIES = [...new Set(Object.values(CATEGORY_MAP))];

const CATEGORY_LABELS = {
  payment: 'Payment & Billing',
  order: 'Order & Booking',
  technical: 'Technical Issue',
  general: 'General Enquiry',
  account: 'Account Management',
};

const CATEGORY_SLA = Object.freeze({
  payment: 24,
  order: 12,
  technical: 4,
  general: 48,
  account: 24,
});

const CATEGORY_DESCRIPTIONS = {
  payment: 'Issues related to payments, invoices, billing, and refunds.',
  order: 'Issues related to load bookings, orders, and shipment tracking.',
  technical: 'App crashes, bugs, and technical difficulties.',
  general: 'General questions and inquiries.',
  account: 'Login problems, account settings, and profile access.',
};

/**
 * @route GET /api/support/categories
 * @desc Retrieve the valid support ticket categories, their human-readable labels, descriptions, and SLA response times
 * @access Public (No authentication required)
 * @returns {object} 200 - Object containing categories array, labels map, SLA hours map, and descriptions map
 */
router.get('/categories', (_req, res) => {
  // Optimize: Add caching header for static support categories
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({
    categories: VALID_CATEGORIES,
    labels: CATEGORY_LABELS,
    sla_hours: CATEGORY_SLA,
    descriptions: CATEGORY_DESCRIPTIONS,
  });
});

// ============================================================================
// 3. CREATE SUPPORT TICKET (AUTHENTICATED USER)
// ============================================================================
/**
 * @openapi
 * /api/support/tickets:
 *   post:
 *     tags: [Support]
 *     summary: Create a support ticket
 *     description: Creates a new support ticket for the authenticated user. Category is normalized via alias map.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTicketRequest'
 *     responses:
 *       201:
 *         description: Ticket created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketResponse'
 *       400:
 *         description: Validation error
 */
router.post('/tickets', authenticate, userLimiter, validateBody(createTicketSchema), async (req, res) => {
  const subject = normalizeRequiredText(req.body.subject);
  const category = normalizeRequiredText(req.body.category);
  const description = normalizeRequiredText(req.body.description) || subject;

  const normalizedCategory = category.toLowerCase().trim();
  const dbCategory = CATEGORY_MAP[normalizedCategory];

  if (!dbCategory) {
    return res.status(400).json({
      error: `Invalid support ticket category. Must be one of: ${Object.keys(CATEGORY_MAP).join(', ')}`,
    });
  }

  try {
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: req.user.id,
        subject,
        description,
        category: dbCategory,
        status: 'open',
      })
      .select(TICKET_COLUMNS)
      .single();

    if (error) {
      return res.status(500).json({
        error: 'Failed to create support ticket.',
        details: error.message,
      });
    }

    res.status(201).json({
      message: 'Support ticket created successfully.',
      ticket,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. LIST CURRENT USER'S SUPPORT TICKETS (AUTHENTICATED USER)
// ============================================================================
/**
 * @openapi
 * /api/support/tickets:
 *   get:
 *     tags: [Support]
 *     summary: List user's support tickets
 *     description: Returns paginated support tickets for the authenticated user. Optional filters by status and category.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated ticket list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketListResponse'
 */
router.get('/tickets', authenticate, userLimiter, async (req, res) => {
  const { status, category, page = '1', limit = '20' } = req.query;
  const parsedPage = parsePositiveInteger(page, 1, 'page');
  if (parsedPage.error) {
    return res.status(400).json({ error: parsedPage.error });
  }
  const parsedLimit = parsePositiveInteger(limit, 20, 'limit');
  if (parsedLimit.error) {
    return res.status(400).json({ error: parsedLimit.error });
  }

  const pageNum = parsedPage.value;
  const limitNum = Math.min(100, parsedLimit.value);
  const offset = (pageNum - 1) * limitNum;
  const normalizedCategory = typeof category === 'string' ? category.toLowerCase().trim() : '';
  const dbCategory = CATEGORY_MAP[normalizedCategory] || null;

  if (category && !dbCategory) {
    return res.status(400).json({ error: 'Unsupported support ticket category.' });
  }

  const statusResult = parseTicketStatus(status);
  if (statusResult.error) {
    return res.status(400).json({ error: statusResult.error });
  }

  try {
    let query = supabase
      .from('support_tickets')
      .select(TICKET_COLUMNS, { count: 'exact' })
      .eq('user_id', req.user.id);

    if (statusResult.value) {
      query = query.eq('status', statusResult.value);
    }

    if (dbCategory) {
      query = query.eq('category', dbCategory);
    }

    const { data: tickets, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch support tickets.',
        details: error.message,
      });
    }

    res.json({
      tickets: tickets || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limitNum) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. GET SINGLE SUPPORT TICKET (AUTHENTICATED USER - OWNER)
// ============================================================================
/**
 * @openapi
 * /api/support/tickets/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get a single support ticket
 *     description: Returns details of a specific support ticket. Only the ticket owner or admin can access.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Ticket details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       403:
 *         description: Access denied
 *       404:
 *         description: Ticket not found
 */
router.get('/tickets/:id', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {
  const ticketId = req.params.id;

  try {
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select(TICKET_DETAIL_COLUMNS)
      .eq('id', ticketId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch support ticket.',
        details: error.message,
      });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found.' });
    }

    if (ticket.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You do not own this ticket.' });
    }

    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 6. UPDATE SUPPORT TICKET (AUTHENTICATED USER - OWNER OR ADMIN)
// ============================================================================
/**
 * @openapi
 * /api/support/tickets/{id}:
 *   patch:
 *     tags: [Support]
 *     summary: Update a support ticket
 *     description: Updates a support ticket's subject, description, category, or status. Only ticket owner or admin can update. Non-admin users can only change status to 'closed'.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTicketRequest'
 *     responses:
 *       200:
 *         description: Ticket updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketResponse'
 *       400:
 *         description: Cannot update closed ticket
 *       403:
 *         description: Access denied
 *       404:
 *         description: Ticket not found
 */
router.patch('/tickets/:id', authenticate, userLimiter, validateBody(updateTicketSchema), async (req, res) => {
  const ticketId = req.params.id;
  const { subject, description, category, status } = req.body;

  try {
    const { data: ticket, error: fetchError } = await supabase
      .from('support_tickets')
      .select('id, user_id, status')
      .eq('id', ticketId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        error: 'Failed to fetch support ticket.',
        details: fetchError.message,
      });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found.' });
    }

    if (ticket.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You do not own this ticket.' });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'Cannot update a closed ticket.' });
    }

    const updates = { updated_at: new Date().toISOString() };

    if (subject !== undefined) {
      updates.subject = subject.trim();
    }

    if (description !== undefined) {
      updates.description = description.trim();
    }

    if (category !== undefined) {
      const normalized = category.toLowerCase().trim();
      const dbCategory = CATEGORY_MAP[normalized];
      if (!dbCategory) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${Object.keys(CATEGORY_MAP).join(', ')}`,
        });
      }
      updates.category = dbCategory;
    }

    if (status !== undefined) {
      const normalizedStatus = status.toLowerCase().trim();
      const USER_ALLOWED_STATUSES = ['closed'];
      if (req.user.role !== 'admin' && normalizedStatus !== ticket.status) {
        if (!USER_ALLOWED_STATUSES.includes(normalizedStatus)) {
          return res.status(403).json({
            error: 'Access Denied: Only admins can change ticket status.',
          });
        }
      }
      updates.status = normalizedStatus;
    }

    const { data: updatedTicket, error: updateError } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticketId)
      .select(TICKET_COLUMNS)
      .single();

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to update support ticket.',
        details: updateError.message,
      });
    }

    res.json({
      message: 'Support ticket updated successfully.',
      ticket: updatedTicket,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 7. LIST ALL TICKETS (ADMIN ONLY)
// ============================================================================
/**
 * @openapi
 * /api/support/admin/tickets:
 *   get:
 *     tags: [Support]
 *     summary: List all tickets (Admin)
 *     description: Returns all support tickets with optional filters by status, category, and user. Admin role required.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated admin ticket list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketListResponse'
 *       403:
 *         description: Admin role required
 */
router.get('/admin/tickets', authenticate, userLimiter, requirePolicy('ticket:admin-view-all'), async (req, res) => {
  const { status, category, user_id, page = '1', limit = '20' } = req.query;
  const parsedPage = parsePositiveInteger(page, 1, 'page');
  if (parsedPage.error) {
    return res.status(400).json({ error: parsedPage.error });
  }
  const parsedLimit = parsePositiveInteger(limit, 20, 'limit');
  if (parsedLimit.error) {
    return res.status(400).json({ error: parsedLimit.error });
  }

  const pageNum = parsedPage.value;
  const limitNum = Math.min(100, parsedLimit.value);
  const offset = (pageNum - 1) * limitNum;
  const normalizedCategory = typeof category === 'string' ? category.toLowerCase().trim() : '';
  const dbCategory = CATEGORY_MAP[normalizedCategory] || null;

  if (category && !dbCategory) {
    return res.status(400).json({ error: 'Unsupported support ticket category.' });
  }

  const userIdResult = parseUuidQuery(user_id, 'user_id');
  if (userIdResult.error) {
    return res.status(400).json({ error: userIdResult.error });
  }

  const statusResult = parseTicketStatus(status);
  if (statusResult.error) {
    return res.status(400).json({ error: statusResult.error });
  }

  try {
    let query = supabase
      .from('support_tickets')
      .select(TICKET_DETAIL_COLUMNS, { count: 'exact' });

    if (statusResult.value) {
      query = query.eq('status', statusResult.value);
    }

    if (dbCategory) {
      query = query.eq('category', dbCategory);
    }

    if (userIdResult.value) {
      query = query.eq('user_id', userIdResult.value);
    }

    const { data: tickets, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch tickets.',
        details: error.message,
      });
    }

    res.json({
      tickets: tickets || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limitNum) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/support/tickets/{id}/comments:
 *   post:
 *     tags: [Support]
 *     summary: Add a comment to a support ticket
 *     description: Adds a comment/reply to an existing support ticket. Only the ticket owner or admin can comment. Cannot comment on closed tickets.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCommentRequest'
 *     responses:
 *       201:
 *         description: Comment added
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CommentResponse'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Ticket not found
 *       409:
 *         description: Cannot comment on closed ticket
 */
/**
 * @route POST /api/support/tickets/:id/comments
 * @desc Create a comment/reply on a support ticket
 * @access Authenticated (Ticket Owner or Admin)
 * @param {string} req.params.id - The UUID of the support ticket
 * @param {string} req.body.message - Comment content/message
 * @returns {object} 201 - Comment added successfully with comment details
 * @returns {object} 400 - Validation errors
 * @returns {object} 403 - Forbidden if user is not the ticket owner or admin
 * @returns {object} 404 - Support ticket not found
 * @returns {object} 409 - Cannot comment on a closed ticket
 * @returns {object} 500 - Internal server error
 */
router.post('/tickets/:id/comments', authenticate, userLimiter, validateParams(uuidParamSchema), validateBody(createTicketCommentSchema), async (req, res) => {
  const ticketId = req.params.id;
  const { message } = req.body;

  try {
    const { data: ticket, error: fetchError } = await supabase
      .from('support_tickets')
      .select('id, user_id, status')
      .eq('id', ticketId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        error: 'Failed to fetch support ticket.',
        details: fetchError.message,
      });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found.' });
    }

    if (ticket.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You do not own this ticket.' });
    }

    if (ticket.status === 'closed') {
      return res.status(409).json({ error: 'Cannot comment on a closed ticket.' });
    }

    const { data: comment, error: insertError } = await supabase
      .from('support_ticket_comments')
      .insert({
        ticket_id: ticketId,
        user_id: req.user.id,
        user_name: req.user.fullName || 'Anonymous',
        message: message.trim(),
        created_at: new Date().toISOString()
      })
      .select('id, ticket_id, user_id, user_name, message, created_at')
      .single();

    if (insertError) {
      return res.status(500).json({
        error: 'Failed to add comment.',
        details: insertError.message,
      });
    }

    res.status(201).json({
      message: 'Comment added successfully.',
      comment,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. GET ALL COMMENTS/REPLIES FOR A TICKET (CUSTOMER OR DRIVER OWNER OR ADMIN)
// ============================================================================
/**
 * @openapi
 * /api/support/tickets/{id}/comments:
 *   get:
 *     tags: [Support]
 *     summary: Get ticket comments
 *     description: Returns all comments for a support ticket. Only the ticket owner or admin can view.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Array of comments
 *       403:
 *         description: Access denied
 *       404:
 *         description: Ticket not found
 */
router.get('/tickets/:id/comments', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const ticketId = req.params.id;
  const { sort } = req.query;
  if (sort !== undefined && sort !== 'asc' && sort !== 'desc') {
    return res.status(400).json({ error: "sort parameter must be 'asc' or 'desc'" });
  }
  const isAscending = sort !== 'desc';

  try {
    const { data: ticket, error: fetchError } = await supabase
      .from('support_tickets')
      .select('id, user_id')
      .eq('id', ticketId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        error: 'Failed to fetch support ticket.',
        details: fetchError.message,
      });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found.' });
    }

    if (ticket.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You do not own this ticket.' });
    }

    const parsedLimit = parsePositiveInteger(req.query.limit, 100, 'limit');
    if (parsedLimit.error) {
      return res.status(400).json({ error: parsedLimit.error });
    }

    const limit = Math.min(100, parsedLimit.value);
    const parsedOffset = parseIntegerQuery(req.query.offset, 0, 'offset', { min: 0 });
    if (parsedOffset.error) {
      return res.status(400).json({ error: parsedOffset.error });
    }
    const offset = parsedOffset.value;

    const { data: comments, error: commentsError } = await supabase
      .from('support_ticket_comments')
      .select('id, ticket_id, user_id, user_name, message, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: isAscending })
      .range(offset, offset + limit - 1);

    if (commentsError) {
      return res.status(500).json({
        error: 'Failed to fetch comments.',
        details: commentsError.message,
      });
    }

    res.json(comments || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

// Resolves #2055: Load-based ticket assignment
