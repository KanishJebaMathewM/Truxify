/**
 * @openapi
 * /api/support/tickets:
 *   post:
 *     tags: [Support]
 *     summary: Create a support ticket
 *     description: Creates a new support ticket for authenticated users.
 *     security:
 *       - BearerAuth: []
 */
router.post('/tickets', authenticate, userLimiter, requireIdempotency(3600), validateBody(createSupportTicketSchema), async (req, res) => {
  const { subject, description, category } = req.body;

  try {
    const normalizedSubject = normalizeRequiredText(subject);

    // Validate that the normalized subject is not empty or whitespace-only
    if (!normalizedSubject || normalizedSubject.trim() === '') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Support ticket subject cannot be empty or contain only whitespace.',
      });
    }

    const normalizedDescription = normalizeRequiredText(description);
    const ticketCategory = category || 'general';

    const newTicket = {
      user_id: req.user.id,
      subject: normalizedSubject,
      description: normalizedDescription,
      category: ticketCategory,
      status: 'open',
      created_at: new Date().toISOString(),
    };

    const { data: savedTicket, error: saveErr } = await supportRepository.insertTicket(newTicket);
    if (saveErr) {
      logger.error('[support] Failed to create support ticket:', saveErr.message);
      return res.status(500).json({ error: 'Failed to create support ticket.' });
    }

    return res.status(201).json({
      message: 'Support ticket created successfully.',
      ticket: savedTicket,
    });
  } catch (err) {
    logger.error('[support] Exception in ticket creation:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
