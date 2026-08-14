# Reverse Geocoding Utility

The `reverseGeocode()` function in `backend/api/src/lib/reverseGeocode.js` converts latitude/longitude coordinates into human-readable addresses using the OpenStreetMap Nominatim API.

## Function Signature

```javascript
async function reverseGeocode(lat, lon): Promise<string|null>
```

**Parameters:**
- `lat` (number|string): Latitude in decimal degrees
- `lon` (number|string): Longitude in decimal degrees

**Returns:** Formatted address string, or `null` on failure.

## Caching

- Results are cached in Redis with a 7-day TTL
- Coordinates are rounded to 3 decimal places (~100m precision) to maximize cache hits
- Cache key format: `geocode:{lat},{lon}`

## Nominatim API Usage

- Endpoint: `https://nominatim.openstreetmap.org/reverse`
- Required header: `User-Agent: Truxify-Node-Backend/1.0`
- Rate limit: Nominatim requires max 1 request/second. The function implements retry with `Retry-After` header support for 429 responses.

## Error Handling

- Invalid coordinates (null, undefined, NaN): returns `null` immediately
- Network errors: caught and logged, returns `null`
- HTTP errors (non-2xx): logged with status code, returns `null`
- 429 rate limit: retries once after `Retry-After` delay (max 60s)

## Testing Notes

Test with mock Redis and fetch. Coordinate rounding must produce correct cache keys for cache hit verification.
