import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { createTicketSchema, updateTicketSchema } from '../validation/requestSchemas.js';

const router = express.Router();

const FAQ_COLUMNS = 'id, question, answer, app_type, sort_order';
const TICKET_COLUMNS = 'id, subject, description, category, status, created_at, updated_at';
const TICKET_DETAIL_COLUMNS = 'id, user_id, subject, description, category, status, created_at, updated_at';

function normalizeRequiredText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ============================================================================
// 1. LIST ACTIVE FAQS (PUBLIC)
// ============================================================================
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
const VALID_CATEGORIES = [
  { value: 'billing', label: 'Billing and Payment', description: 'Issues related to payments, invoices, and charges' },
  { value: 'booking', label: 'Booking and Orders', description: 'Issues related to load bookings and order management' },
  { value: 'technical', label: 'Technical Issues', description: 'App crashes, bugs, and technical difficulties' },
  { value: 'account', label: 'Account and Access', description: 'Login problems, account settings, and access issues' },
  { value: 'general', label: 'General Inquiry', description: 'Questions and inquiries not covered by other categories' },
];

router.get('/categories', async (req, res) => {
  res.json(VALID_CATEGORIES);
});

// ============================================================================
// 3. CREATE SUPPORT TICKET (AUTHENTICATED USER)
// ============================================================================
router.post('/tickets', authenticate, userLimiter, validateBody(createTicketSchema), async (req, res) => {
  const subject = normalizeRequiredText(req.body.subject);
  const category = normalizeRequiredText(req.body.category);
  const description = normalizeRequiredText(req.body.description) || subject;

  // Map user-friendly/frontend categories to database-constrained values
  const CATEGORY_MAP = {
    billing: 'payment',
    booking: 'order',
    payment: 'payment',
    order: 'order',
    technical: 'technical',
    general: 'general',
    account: 'account'
  };

  const normalizedCategory = category.toLowerCase();
  const dbCategory = CATEGORY_MAP[normalizedCategory] || 'general';

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
router.get('/tickets', authenticate, userLimiter, async (req, res) => {
  const { status, category, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('support_tickets')
      .select(TICKET_COLUMNS, { count: 'exact' })
      .eq('user_id', req.user.id);

    if (status) {
      query = query.eq('status', status);
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
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. GET SINGLE SUPPORT TICKET (AUTHENTICATED USER - OWNER)
// ============================================================================
router.get('/tickets/:id', authenticate, userLimiter, async (req, res) => {
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

    const CATEGORY_MAP = {
      billing: 'payment', booking: 'order', payment: 'payment',
      order: 'order', technical: 'technical', general: 'general', account: 'account',
    };

    const updates = { updated_at: new Date().toISOString() };

    if (subject !== undefined) {
      updates.subject = subject.trim();
    }

    if (description !== undefined) {
      updates.description = description.trim();
    }

    if (category !== undefined) {
      const normalized = category.toLowerCase().trim();
      const dbCategory = CATEGORY_MAP[normalized] || 'general';
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
router.get('/admin/tickets', authenticate, userLimiter, requireRole(['admin']), async (req, res) => {
  const { status, category, user_id, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('support_tickets')
      .select(TICKET_DETAIL_COLUMNS, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (user_id) {
      query = query.eq('user_id', user_id);
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

export default router;
