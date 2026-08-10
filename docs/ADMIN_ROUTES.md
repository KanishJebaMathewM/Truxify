# Admin Dashboard API

## GET /api/v1/admin/dashboard

Returns aggregated dashboard statistics. Requires the `admin:view-dashboard`
policy and records an audit event.

```json
{
  "active_drivers": 42,
  "pending_orders": 7,
  "total_revenue_today": 184500
}
```

### Fields

| Field               | Description                                      |
| ------------------- | ------------------------------------------------ |
| `active_drivers`    | Profiles with role `driver` and `is_active` true.|
| `pending_orders`    | Orders with status `pending`.                    |
| `total_revenue_today`| Sum of `total_amount` for delivered / payment-released orders since midnight IST. |

### Notes

- "Today" is computed against Indian Standard Time (UTC+5:30) so the daily
  figure aligns with the Indian business day.
- Revenue sums `total_amount` in paisa as stored on the order row.

### Errors

| Status | Meaning                          |
| ------ | -------------------------------- |
| 500    | `{ error: "Failed to fetch ..." }` |
