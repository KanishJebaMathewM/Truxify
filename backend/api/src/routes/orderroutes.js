router.put(
  '/:id/milestones',
  authenticate,
  userLimiter,
  requirePolicy('milestone:update'),
  milestoneLimiter,
  requireIdempotency(3600),
  validateParams(paramIdSchema),
  validateBody(updateMilestoneSchema),
  async (req, res) => {
