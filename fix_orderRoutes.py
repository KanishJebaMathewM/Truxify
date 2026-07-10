import re

with open('/tmp/orderRoutes.js', 'r') as f:
    code = f.read()

# Let's fix POST /:id/milestone properly. The block spans from router.post('/:id/milestone' down to router.post('/:id/verify-delivery'
match = re.search(r"(router\.post\('/:id/milestone',.*?)// ============================================================================\n// 13\. VERIFY DELIVERY OTP", code, re.DOTALL)
if match:
    code = code[:match.start()] + """router.post('/:id/milestone', authenticate, userLimiter, requireRole(['driver']), validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;
  try {
    const result = await orderMilestoneService.updateMilestone({ orderId, milestone, driverId: req.user.id });
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Milestone update error:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13. VERIFY DELIVERY OTP""", code[match.end()-86:]  # Need to append the rest properly
    
    # Actually simpler:
    code = re.sub(
        r"router\.post\('/:id/milestone',.*?\n// ============================================================================\n// 13\. VERIFY DELIVERY OTP",
        """router.post('/:id/milestone', authenticate, userLimiter, requireRole(['driver']), validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;
  try {
    const result = await orderMilestoneService.updateMilestone({ orderId, milestone, driverId: req.user.id });
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Milestone update error:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13. VERIFY DELIVERY OTP""",
        code, flags=re.DOTALL
    )

with open('/Users/cursed/Documents/GSSOC/Truxify/backend/api/src/routes/orderRoutes.js', 'w') as f:
    f.write(code)

print("done")
