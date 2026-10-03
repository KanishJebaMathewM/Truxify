# Order Milestone API

## Endpoint: Update Geofence Milestone
Automatically advances the order lifecycle state machine when the driver app detects proximity to a pickup or dropoff location.

### Request
`PUT /api/orders/:id/milestones`

**Headers:**
- `Authorization: Bearer <driver_jwt>`

**Body:**
```json
{
  "milestone": "Arrived at Pickup" | "Arriving at Dropoff"
}
```

### Response (200 OK)

```json
{
  "message": "Milestone updated: Arrived at Pickup",
  "order_display_id": "TRX-8842",
  "new_status": "arrived_pickup"
}
```


### Location of Change in `backend/api/src/routes/orderRoutes.js`
Apply this patch to register the route (around line 168 where `updateMilestoneSchema` is imported):
```javascript
// Find the imports section and ensure updateMilestoneSchema is imported
// import { ..., updateMilestoneSchema } from '../validation/requestSchemas.js';

// Add this route block inside the router definition:
router.put('/:id/milestones',
  authenticate,
  userLimiter,
  requirePolicy('milestone:update'),
  validateParams(paramIdSchema),
  validateBody(updateMilestoneSchema),
  async (req, res, next) => {
    try {
      const result = await orderMilestoneService.updateGeofenceMilestone({
        orderId: req.params.id,
        milestone: req.body.milestone,
        driverId: req.user.id
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  }
);

