# Audit Log Routes

Admin endpoints for querying the application audit log.

## GET /api/v1/admin/audit-logs

Returns a paginated, filterable list of audit log entries. Requires the
`admin:view-audit-logs` policy.

### Query parameters

| Parameter     | Type   | Notes                                    |
| ------------- | ------ | ---------------------------------------- |
| `actor_id`    | uuid   | Filter by acting user.                   |
| `action`      | string | Exact match on action.                   |
| `resource_type` | string | Exact match.                            |
| `resource_id` | string | Exact match.                             |
| `start_date`  | string | ISO 8601 datetime, inclusive.            |
| `end_date`    | string | ISO 8601 datetime, inclusive.            |
| `page`        | int    | Default 1.                               |
| `limit`       | int    | Default 20, max 100.                     |
| `sort_by`     | string | `created_at` (default), `action`, `resource_type`, `actor_id`, `method`. |
| `sort_order`  | string | `asc` or `desc` (default).               |

## GET /api/v1/admin/audit-logs/:id

Returns a single entry by UUID.

| Status | Meaning                                  |
| ------ | ---------------------------------------- |
| 200    | Entry found.                             |
| 404    | Entry not found.                         |
| 503    | Admin database client not configured.    |
