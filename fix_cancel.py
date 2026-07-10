import re

with open('/Users/cursed/Documents/GSSOC/Truxify/backend/api/src/routes/orderRoutes.js', 'r') as f:
    code = f.read()

# Match router.post('/:id/cancel' down to // ============================================================================
# // 17. CONFIRM ESCROW DEPOSIT (CUSTOMER)
match = re.search(r"(router\.post\('/:id/cancel',.*?)// ============================================================================\n// 17\. CONFIRM ESCROW DEPOSIT \(CUSTOMER\)", code, re.DOTALL)
if match:
    code = code[:match.start()] + """router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(cancelOrderSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { cancellation_reason } = req.body;
    const result = await orderLifecycleService.cancelOrder(orderId, req.user.id, cancellation_reason);
    if (result.status === 202) {
      return res.status(202).json(result.body);
    }
    return res.json(result.body);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Cancel order exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error'});
  }
});

// ============================================================================
// 17. CONFIRM ESCROW DEPOSIT (CUSTOMER)
""" + code[match.end()-39:]

with open('/Users/cursed/Documents/GSSOC/Truxify/backend/api/src/routes/orderRoutes.js', 'w') as f:
    f.write(code)

print("done")
