# Truxify Backend API Reference

> This document provides an overview of the Truxify backend REST APIs, authentication requirements, request conventions, and available endpoints.

---

# Table of Contents

- Overview
- Base URL
- Authentication
- Request Headers
- Response Format
- Error Responses
- HTTP Status Codes
- API Modules
  - Health
  - Authentication
  - Orders
  - Driver
  - Earnings
  - Trucks
  - Profile
  - Device
  - Documents
  - Tracking
  - Trips
  - Support
  - Lookups
  - Verification
  - Oracle
  - Admin
  - Fraud Detection
  - Carbon Credits
  - WebRTC
  - Zero-Knowledge Proof (ZKP)
  - Road Conditions
  - IoT Telemetry
  - Cross-Docking
- Rate Limiting
- Idempotency
- WebSocket Events
- Future Improvements

---

# Overview

The Truxify backend exposes a REST API for managing freight logistics, user authentication, driver operations, truck management, live tracking, blockchain verification, support, and analytics.

Most endpoints require authentication using a Bearer token.

---

# Base URL

```
http://localhost:5000/api
```

Production deployments may use a different base URL.

---

# Authentication

Most endpoints require authentication.

Example:

```
Authorization: Bearer <JWT_TOKEN>
```

Unauthenticated requests receive:

```
401 Unauthorized
```

---

# Request Headers

Common headers:

```
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

---

# Response Format

Successful responses generally follow:

```json
{
  "success": true,
  "data": {}
}
```

Error responses from the global API error handler use the following structure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {}
  }
}
```

The error.code identifies the error category, error.message contains the human-readable message, and error.details contains structured context when available. Route-specific handlers may return a simpler error shape; when an endpoint documents a different response, follow that endpoint's contract.

---

# HTTP Status Codes

| Code | Meaning |
|------|---------|
|200|Success|
|201|Created|
|400|Bad Request|
|401|Unauthorized|
|403|Forbidden|
|404|Not Found|
|409|Conflict|
|422|Validation Error|
|429|Too Many Requests|
|500|Internal Server Error|

---

# API Modules

---

## Health

Base Path

```
/api/health
```

Endpoints

| Method | Endpoint | Description |
|---------|----------|-------------|
|GET|/|Health status|
|GET|/live|Liveness probe|
|GET|/ready|Readiness probe|

---

## Authentication

Base Path

```
/api/auth
```

Endpoints

| Method | Endpoint |
|---------|----------|
|POST|/logout|
|GET|/session|

---

## Orders

Base Path

```
/api/orders
```

| Method | Endpoint |
|---------|----------|
|POST|/|
|GET|/my/active|
|GET|/history|
|GET|/:id|
|GET|/:id/timeline|
|POST|/:id/bids|
|GET|/:id/bids|
|POST|/:id/bids/:bidId/accept|
|POST|/:id/ratings|
|PUT|/:id/milestones|
|POST|/:id/verify-delivery|
|POST|/:id/resend-otp|
|PUT|/:id/change-drop|
|POST|/:id/cancel|
|POST|/:id/confirm-deposit|
|POST|/predict-demand|
|GET|/:id/driver-location|
|GET|/:id/route|

---

## Driver

Base Path

```
/api/driver
```

Endpoints include:

| Method | Endpoint |
|---------|----------|
|GET|/stats|
|PUT|/online|
|GET|/wallet/history|
|GET|/earnings/summary|
|GET|/trips|
|GET|/trips/:tripDisplayId/items|
|GET|/trips/:tripDisplayId/stops|
|GET|/trips/:tripDisplayId/route-points|
|GET|/bids|
|POST|/wallet/withdraw|
|GET|/:driverId/reputation|

---

## Earnings

Base Path

```
/api/earnings
```

Requires Bearer authentication and the driver:view-earnings policy.

| Method | Endpoint | Description |
|---------|----------|-------------|
|GET|/summary|Authenticated driver's earnings summary; supports period=weekly or period=monthly|

Example:

```http
GET /api/earnings/summary?period=monthly
Authorization: Bearer <JWT_TOKEN>
```

---
## Drone

Base Path

```
/api/drone
```

### Launch

**POST /launch**

Launches a last-mile drone delivery handoff. Requires Bearer authentication and a `driver`, `dispatcher`, or `admin` role.

Request body:

```json
{"trip_id":"TRP-101","parcel_id":"PCL-9988","safe_zone_gps":{"lat":28.6139,"lng":77.209},"destination_gps":{"lat":28.63,"lng":77.22}}
```

Required fields:

- `trip_id`: identifier, 1-64 characters; only A–Z, a–z, 0–9, underscore, hyphen, colon, and period are allowed
- `parcel_id`: identifier, 1-64 characters; only A–Z, a–z, 0–9, underscore, hyphen, colon, and period are allowed
- `safe_zone_gps`: latitude [-90, 90] and longitude [-180, 180]
- `destination_gps`: latitude [-90, 90] and longitude [-180, 180]

The flight distance is calculated with the Haversine formula and must not exceed **25 km**.

Successful response: `201 Created`

```json
{"message":"Drone delivery handoff launched successfully","flightDistanceKm":2.13,"mission":{}}
```

Possible errors: `400` for invalid or excessive launch parameters, `401` for missing authentication, `403` for an unauthorized role, `429` for rate limiting, and `500` for launch failures.

---


## Trucks

Base Path

```
/api/trucks
```

| Method | Endpoint |
|---------|----------|
|GET|/types|
|POST|/|
|GET|/|
|GET|/search|
|GET|/:id/number|

---

## Profile

Base Path

```
/api/profile
```

| Method | Endpoint |
|---------|----------|
|GET|/|
|PUT|/|
|PUT|/wallet|
|PUT|/fcm-token|
|GET|/:id/name|
|GET|/driver/statement|
|DELETE|/admin/cache/:userId|

---

## Devices

Base Path

```
/api/devices
```

| Method | Endpoint |
|---------|----------|
|POST|/register|
|DELETE|/unregister|
|GET|/platforms|

---

## Driver Documents

Base Path

```
/api/driver/documents
```

| Method | Endpoint |
|---------|----------|
|POST|/|

---

## Loads

Base Path

```
/api/loads
```

| Method | Endpoint |
|---------|----------|
|GET|/|
|GET|/:id|

---

## IoT Telemetry

Base Path

```
/api/iot
```

Authentication

All telemetry endpoints require a Bearer token. Access is restricted to the load owner, the currently assigned driver, an appropriately assigned IoT device, or an administrator.

The telemetry history endpoint is additionally rate-limited to 300 requests per 15 minutes per client key.

### Record telemetry

```
POST /api/iot/telemetry/<load_id>
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

Request body:

```json
{
  "temperature": 4.5
}
```

Temperature must be a finite number between `-100` and `200` °C.

A telemetry submission is accepted only for an existing load that requires refrigeration. Provisioned IoT devices must also be assigned to the target load.

Successful response:

```json
{
  "success": true,
  "message": "Telemetry recorded",
  "analysis": {}
}
```

### Retrieve telemetry history

```
GET /api/iot/telemetry/<load_id>
```

The response contains up to the 20 most recent telemetry rows for the load, ordered newest first.

Example:

```json
[
  {
    "id": "uuid",
    "load_id": "uuid",
    "temperature": 4.5,
    "recorded_at": "2026-09-19T12:00:00.000Z"
  }
]
```

### IoT telemetry authorization and status codes

| Code | Meaning |
|------|---------|
|200|Telemetry history returned|
|201|Telemetry reading recorded|
|400|Invalid payload, invalid load state, or non-refrigerated load|
|401|Authentication required|
|403|Caller is not authorized for the load|
|404|Load not found|
|500|Database, authorization, anomaly-processing, or unexpected server error|


## Cross-Docking

Base Path

```
/api/cross-dock
```

Authentication

All cross-dock endpoints require a Bearer token. Route-level policies and participant checks additionally restrict each operation:

| Operation | Allowed roles / policy |
|-----------|------------------------|
|GET /candidates|driver, admin — `crossdock:list-candidates`|
|POST /|driver — `crossdock:create`|
|GET /|driver, admin — `crossdock:list`|
|GET /:id|driver, admin — `crossdock:view`|
|POST /:id/accept|driver — `crossdock:accept`|
|POST /:id/decline|driver — `crossdock:decline`|
|POST /:id/cancel|driver — `crossdock:cancel`|
|POST /:id/verify|driver — `crossdock:verify`|

### Find candidate drivers

```
GET /api/cross-dock/candidates?orderId=<uuid>&cross_dock_lat=28.6139&cross_dock_lng=77.2090&radius_km=50&limit=20
```

Parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
|orderId|Yes|UUID of the load/order to relay.|
|cross_dock_lat|Yes|Cross-dock latitude, from -90 to 90.|
|cross_dock_lng|Yes|Cross-dock longitude, from -180 to 180.|
|radius_km|No|Search radius in kilometres, 1–500. Defaults to 50 km.|
|limit|No|Maximum candidates to return, 1–50. Defaults to 20.|

Successful response:

```json
{
  "candidates": [
    {
      "driver_id": "uuid",
      "name": "Driver Name",
      "distance_km": 8.42,
      "last_seen_at": "2026-09-19T12:00:00.000Z"
    }
  ]
}
```

### Create a transfer request

```
POST /api/cross-dock?orderId=<uuid>
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

Request body:

```json
{
  "to_driver_id": "uuid",
  "cross_dock_lat": 28.6139,
  "cross_dock_lng": 77.2090,
  "cross_dock_note": "Meet at the north truck entrance"
}
```

The request must target another driver and the authenticated driver must currently be carrying a load whose status permits handoff.

Successful response:

```json
{
  "id": "uuid",
  "status": "requested",
  "from_driver_id": "uuid",
  "to_driver_id": "uuid",
  "cross_dock_lat": 28.6139,
  "cross_dock_lng": 77.2090,
  "expires_at": "2026-09-19T13:00:00.000Z",
  "created_at": "2026-09-19T12:00:00.000Z",
  "handoff_code": "123456"
}
```

### List transfers

```
GET /api/cross-dock?status=requested&limit=50
```

`status` is optional and may be `requested`, `accepted`, `verified`, `declined`, `cancelled`, or `expired`. `limit` defaults to 50 and the service caps it at 200.

Successful response:

```json
{
  "transfers": []
}
```

### Get a transfer

```
GET /api/cross-dock/<transfer_id>
```

Only participating drivers may retrieve a transfer. Sensitive OTP fields are stripped from the response.

Successful response:

```json
{
  "transfer": {
    "id": "uuid",
    "order_id": "uuid",
    "from_driver_id": "uuid",
    "to_driver_id": "uuid",
    "status": "accepted",
    "cross_dock_lat": 28.6139,
    "cross_dock_lng": 77.2090,
    "created_at": "2026-09-19T12:00:00.000Z",
    "expires_at": "2026-09-19T13:00:00.000Z",
    "verified_at": null
  }
}
```

### Accept, decline, or cancel a transfer

```
POST /api/cross-dock/<transfer_id>/accept
POST /api/cross-dock/<transfer_id>/decline
POST /api/cross-dock/<transfer_id>/cancel
```

These operations require the authenticated participant permitted by the corresponding policy. Successful responses return the updated transfer object.

### Verify handoff

```
POST /api/cross-dock/<transfer_id>/verify
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

Request body:

```json
{
  "handoff_code": "123456"
}
```

The handoff code must be exactly six digits. On successful verification the transfer moves to `verified` and the load custody is reassigned to the receiving driver.

### Cross-dock status codes

| Code | Meaning |
|------|---------|
|200|Successful lookup, listing, or lifecycle operation|
|201|Transfer created|
|400|Invalid UUID/query/body, invalid status, or invalid handoff request|
|401|Authentication required|
|403|Role, policy, or participant authorization failure|
|404|Load or transfer not found|
|409|Invalid lifecycle state or concurrent/duplicate transfer conflict|
|410|Transfer or handoff code expired|
|500|Unexpected or database error|
|503|Nearby-driver lookup unavailable|


## Road Conditions

Base Path

```
/api/road-conditions
```

Authentication

Both road-condition endpoints require a Bearer token and are protected by a telemetry rate limiter allowing up to 100 requests per 5 minutes per client key.

### Report grip telemetry

```
POST /api/road-conditions/grip
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

Request body:

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "grip_index": 7.5,
  "slip_events_count": 1
}
```

Field rules:

| Field | Required | Constraints |
|-------|----------|-------------|
|latitude|Yes|Finite number in [-90, 90].|
|longitude|Yes|Finite number in [-180, 180].|
|grip_index|Yes|Number in [0, 10].|
|slip_events_count|No|Number >= 0; defaults to 0.|

Successful response:

```json
{
  "success": true,
  "message": "Grip data reported successfully"
}
```

### Retrieve nearby grip telemetry

```
GET /api/road-conditions/grip/nearby?lat=28.6139&lng=77.2090&radius_miles=50
```

Query parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
|lat|Yes|Latitude in [-90, 90].|
|lng|Yes|Longitude in [-180, 180].|
|radius_miles|No|Finite radius greater than 0 and at most 1000 miles. Defaults to 50.|

The endpoint searches for reports from the previous 12 hours and returns at most 100 results.

Successful response:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "latitude": 28.6139,
      "longitude": 77.2090,
      "grip_index": 7.5,
      "slip_events_count": 1,
      "recorded_at": "2026-09-19T12:00:00.000Z"
    }
  ]
}
```

### Road-condition status codes

| Code | Meaning |
|------|---------|
|200|Nearby grip data returned|
|201|Grip telemetry recorded|
|400|Invalid telemetry payload, missing coordinates, or invalid coordinate/radius values|
|401|Authentication required|
|500|Database or unexpected server error|


## Support

Base Path

```
/api/support
```

| Method | Endpoint |
|---------|----------|
|GET|/faqs|
|GET|/categories|
|POST|/tickets|
|GET|/tickets|
|GET|/tickets/:id|
|PATCH|/tickets/:id|
|POST|/tickets/:id/comments|
|GET|/tickets/:id/comments|
|GET|/admin/tickets|

---

## Trips

Base Path

```
/api/v1/trips
```

| Method | Endpoint |
|---------|----------|
|POST|/events/batch|
|GET|/:id/events|

---

## Lookups

Base Path

```
/api/v1
```

| Method | Endpoint |
|---------|----------|
|GET|/vehicle-types|
|GET|/regions|

---

## Verification

Base Path

```
/api/verify
```

| Method | Endpoint |
|---------|----------|
|GET|/order/:orderId|
|POST|/documents/check|

---

## Oracle

Base Path

```
/api/oracle
```

| Method | Endpoint |
|---------|----------|
|GET|/status|
|POST|/confirm|
|POST|/verify-crosschain|

---

## Admin

Base Path

```
/api/v1/admin
```

| Method | Endpoint |
|---------|----------|
|GET|/dashboard|

---

## Fraud Detection

Base Path

```
/api
```

| Method | Endpoint |
|---------|----------|
|GET|/fraud/stats|
|GET|/fraud/risk/:userId|
|GET|/fraud/review-queue|
|POST|/fraud/review/:reviewId/resolve|
|POST|/fraud/track|
|POST|/fraud/analyze-network/:userId|

---

## Carbon Credits

Base Path

```
/api/carbon-credits
```

All endpoints require Bearer authentication.

| Method | Endpoint | Description |
|---------|----------|-------------|
|POST|/mint|Calculate freight carbon savings and mint carbon credits|
|POST|/purchase|Purchase and retire carbon credits for Scope 3 offsetting|
|GET|/:tokenId|Retrieve token details and chain verification state|

### Mint Carbon Credits

```json
{
  "truck_id": "truck_123",
  "trip_id": "trip_456",
  "distance_km": 312.5,
  "fuel_saved_liters": 18.4,
  "load_weight_kg": 12000
}
```

The truck_id, trip_id, and fuel_saved_liters fields are required. Distance and load weight default to zero when omitted and all numeric values must be finite and non-negative.

### Purchase Carbon Credits

```json
{
  "token_id": "carbon_123",
  "buyer_address": "0x0000000000000000000000000000000000000000"
}
```

### Responses

Successful minting returns HTTP 201 with a message and the minted token. Successful purchase and token lookup responses return the resulting token under token.

Unauthenticated requests return HTTP 401; unknown token IDs return HTTP 404.

## Blockchain Monitoring

Base Path

```
/api/blockchain
```

| Method | Endpoint | Description |
|---------|----------|-------------|
|GET|/events|List recent blockchain monitoring events with optional type, severity, and limit filters|

### GET /api/blockchain/events

Requires a Bearer token and an `admin` or `support` role.

Optional query parameters:

| Parameter | Constraints |
|-----------|-------------|
|`type`|One of the documented blockchain event types|
|`severity`|`LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`|
|`limit`|Integer from 1 to 1000; defaults to 50|

Successful responses contain a timestamp, result count, and matching events:

```json
{
  "timestamp": "2026-09-19T12:00:00.000Z",
  "count": 1,
  "events": [
    {
      "id": 1,
      "type": "PAYMENT_RECEIVED",
      "severity": "HIGH",
      "data": {},
      "created_at": "2026-09-19T11:59:00.000Z"
    }
  ]
}
```

Responses:

| Status | Meaning |
|--------|---------|
|200|Matching monitoring events returned|
|400|Invalid type, severity, or limit|
|500|Event lookup failed|

---


## WebRTC

Base Path

```
/api
```

| Method | Endpoint |
|---------|----------|
|GET|/webrtc/stats|
|GET|/webrtc/nearby|
|GET|/webrtc/offline/:peerId|Retrieve bounded offline GPS data for an accessible peer|
|POST|/webrtc/sync/:peerId|Acknowledge synchronized offline GPS rows for an accessible peer|

---

## Zero-Knowledge Proof (ZKP)

Base Path

```
/api
```

| Method | Endpoint |
|---------|----------|
|POST|/zkp/verify|
|GET|/zkp/status/:userId|
|GET|/zkp/document-hash/:userId|
|GET|/zkp/stats|


### GET /api/webrtc/offline/{peerId}

Requires a Bearer token and the `webrtc:view-offline` policy.

Query parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
|`since`|Yes|Unix timestamp in milliseconds; only newer rows are returned|

Successful responses return bounded offline GPS rows:

```json
{
  "success": true,
  "data": [
    {
      "id": "row-1",
      "data": {},
      "timestamp": 1726339200000,
      "synced": false
    }
  ]
}
```

Responses:

| Status | Meaning |
|--------|---------|
|200|Offline GPS data retrieved|
|400|Invalid or missing `since`|
|403|Authenticated user cannot access the peer|
|500|Retrieval failed|
|503|WebRTC signaling server is not initialized|


### POST /api/webrtc/sync/{peerId}

Requires a Bearer token and the `webrtc:sync-offline` policy.

Request body:

```json
{
  "ackedIds": ["row-1", "row-2"]
}
```

`ackedIds` must be a non-empty array containing the offline GPS row IDs the client has successfully received.

Responses:

| Status | Meaning |
|--------|---------|
|200|Offline data synchronized|
|400|`ackedIds` is missing or empty|
|403|Authenticated user cannot access the peer|
|500|Synchronization failed|
|503|WebRTC signaling server is not initialized|

---

# Rate Limiting

Several endpoints apply request rate limiting to prevent abuse. Limits may vary depending on endpoint category (authentication, health checks, user operations, and verification).

---

# Idempotency

Certain write operations require an Idempotency-Key header to safely retry requests without creating duplicate operations.

---

# WebSocket Events

The backend also supports real-time communication for:

- Live driver tracking
- Order updates
- Trip progress
- Notifications

---

# API Documentation

The repository exposes a generated OpenAPI 3.0 specification and an interactive Swagger UI for the backend API.

## Interactive API documentation

Start the backend API in a non-production environment and open:

http://localhost:5000/api/docs

The generated API server URL is controlled by API_PUBLIC_URL. When it is unset, the development server URL defaults to http://localhost:5000/api.

Swagger UI is disabled when NODE_ENV=production.

## OpenAPI source

The generated specification is built with swagger-jsdoc from OpenAPI annotations in backend/api/src/routes/*.js.

Route documentation should remain next to the implementation it describes. Changes to endpoint parameters, request bodies, authentication requirements, or responses should update those annotations together with the implementation.

## Validation

From backend/api:

npm test -- test/unit/swagger.test.js

For endpoint-specific documentation changes, run the focused OpenAPI contract test as well as the Swagger configuration test.

The generated documentation is served by the backend at /api/docs; contributors do not need to maintain a separate static Swagger artifact.