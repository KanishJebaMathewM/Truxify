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
import { supabase, supabaseAdmin, createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import logger from '../middleware/logger.js';
import { auditLog } from '../middleware/auditLog.js';
import { createTicketSchema, updateTicketSchema, createTicketCommentSchema, paramIdSchema, uuidParamSchema } from '../validation/requestSchemas.js';

const router = express.Router();
router.use(userLimiter);

const adminDb = supabaseAdmin || supabase;
const userDb = (req) => createUserClient(req.token);

const FAQ_COLUMNS = 'id, question, answer, app_type, sort_order';
const TICKET_COLUMNS = 'id, subject, description, category, status, assigned_to, created_at, updated_at';
const TICKET_DETAIL_COLUMNS = 'id, user_id, subject, description, category, status, assigned_to, created_at, updated_at';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

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

/**
 * Resolves #2055: Load-based ticket assignment helper.
 * Queries active agents and returns the user_id of the agent with the lowest open ticket count.
 */
async function getNextAvailableAgent() {
  try {
    const { data: agents, error: agentError } = await adminDb
      .from('users')
      .select('id')
      .in('role', ['admin', 'support_agent'])
      .eq('is_active', true);

    if (agentError || !agents || agents.length === 0) {
      return null;
    }

    const agentIds = agents.map((a) => a.id);
    const { data: ticketCounts, error: countError } = await adminDb
      .from('support_tickets')
      .select('assigned_to')
      .in('assigned_to', agentIds)
      .in('status', ['open', 'in_progress']);

    if (countError) {
      return agents[0].id;
    }

    const loadMap = {};
    agentIds.forEach((id) => {
      loadMap[id] = 0;
    });

    (ticketCounts || []).forEach((t) => {
      if (t.assigned_to && loadMap[t.assigned_to] !== undefined) {
        loadMap[t.assigned_to] += 1;
      }
    });

    let selectedAgent = agentIds[0];
    let minLoad = loadMap[selectedAgent];

    for (let i = 1; i < agentIds.length; i++) {
      const currentAgent = agentIds[i];
      if (loadMap[currentAgent] < minLoad) {
        minLoad = loadMap[currentAgent];
        selectedAgent = currentAgent;
      }
    }

    return selectedAgent;
  } catch (err) {
    logger.error("[SupportRoutes] Load-based assignment error:", err?.message || err);
    return null;
  }
}

// ============================================================================
// 1. LIST ACTIVE FAQS (PUBLIC)
// ============================================================================
router.get('/faqs', async (req, res) => {
  const appType = normalizeRequiredText(req.query.app_type);

  try {
    let query = adminDb
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
    logger.error("[SupportRoutes] Error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
});

// ============================================================================
// 2. LIST VALID TICKET CATEGORIES (PUBLIC)
// ============================================================================
const VALID_CATEGORIES = [...new Set(Object.values(CATEGORY_MAP))];

const CATEGORY_LABELS = {
  payment: 'Payment & Billing',
  order: 'Order & Booking',
  technical: 'Technical Issue',
  general: 'General Enquiry',
  account: 'Account Management',
};

const CATEGORY_SLA = {
  payment: 24,
  order: 12,
  technical: 4,
  general: 48,
  account: 24,
};

const CATEGORY_DESCRIPTIONS = {
  payment: 'Issues related to payments, invoices, billing, and refunds.',
  order: 'Issues related to load bookings, orders, and shipment tracking.',
  technical: 'App crashes, bugs, and technical difficulties.',
  general: 'General questions and inquiries.',
  account: 'Login problems, account settings, and profile access.',
};

router.get('/categories', (_req, res) => {
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
router.post('/tickets', authenticate, userLimiter, validateBody(createTicketSchema), async (req, res) => {
  const subject = normalizeRequiredText(req.body.subject);
  if (!subject) {
    return res.status(400).json({ error: 'subject is required and cannot be empty' });
  }
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
    const assignedAgentId = await getNextAvailableAgent();

    const { data: ticket, error } = await userDb(req)
      .from('support_tickets')
      .insert({
        user_id: req.user.id,
        subject,
        description,
        category: dbCategory,
        status: 'open',
        assigned_to: assignedAgentId,
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
    logger.error("[SupportRoutes] Error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
});

// ============================================================================
// 4. LIST CURRENT USER'S SUPPORT TICKETS (AUTHENTICATED USER)
// ============================================================================
router.get('/tickets', authenticate, userLimiter, async (req, res) => {
  const { status, category, page = '1', limit = '20' } = req.query;
  if (page !== undefined && !/^\d+$/.test(page)) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  if (limit !== undefined && !/^\d+$/.test(limit)) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const statusResult = parseTicketStatus(status);
  if (statusResult.error) {
    return res.status(400).json({ error: statusResult.error });
  }

  try {
    let query = userDb(req)
      .from('support_tickets')
      .select(TICKET_COLUMNS, { count: 'exact' })
      .eq('user_id', req.user.id);

    if (statusResult.value) {
      query = query.eq('status', statusResult.value);
    }

    if (category) {
      query = query.eq('category', category);
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
    logger.error("[SupportRoutes] Error:", err?.message || err);
    res.status
