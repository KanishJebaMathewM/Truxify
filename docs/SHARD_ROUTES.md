# Shard Routes

The sharding endpoints expose the geo-sharded order storage layer.

## GET /api/shards/status

Returns the health of every configured shard.

```json
{
  "success": true,
  "data": { "north": "healthy", "south": "healthy" },
  "timestamp": "2026-08-10T00:00:00.000Z"
}
```

## GET /api/shards/location?lat=..&lng=..

Returns the shard responsible for a coordinate pair.

| Query param | Validation        |
| ----------- | ----------------- |
| `lat`       | -90 to 90         |
| `lng`       | -180 to 180       |

```json
{
  "success": true,
  "data": { "shard": "north", "lat": 28.6, "lng": 77.2 }
}
```

## GET /api/shards/:shardName/orders

Returns up to 100 recent orders from a specific shard.

## GET /api/shards/all/orders

Returns a count of orders aggregated across every shard.

All endpoints require the `shard:view` / `shard:query-orders` policies and
are rate limited per user.
