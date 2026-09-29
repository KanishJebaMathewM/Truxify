import { Router } from 'express';
import supportService from '../services/supportService.js';
import { parseLimit, parseOffset } from '../utils/pagination.js';

const router = Router();

/**
 * GET /api/support/tickets/:id/comments
 * Retrieves paginated comments for a specific support ticket.
 */
router.get('/tickets/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Parse and sanitize pagination parameters once
    const parsedLimit = parseLimit(req.query.limit);
    const parsedOffset = parseOffset(req.query.offset);

    const limit = Math.min(100, parsedLimit.value);
    const offset = parsedOffset.value;

    // Fetch comments using sanitized pagination parameters
    const comments = await supportService.getTicketComments(id, { limit, offset });

    return res.json({
      success: true,
      data: comments,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
