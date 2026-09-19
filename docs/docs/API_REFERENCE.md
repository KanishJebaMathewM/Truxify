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

Error responses generally contain:

```json
{
  "success": false,
  "message": "Description of the error"
}
```

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

## WebRTC

Base Path

```
/api
```

| Method | Endpoint |
|---------|----------|
|GET|/webrtc/stats|
|GET|/webrtc/nearby|
|GET|/webrtc/offline/:peerId|
|POST|/webrtc/sync/:peerId|

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

# Future Improvements

Future API versions may include:

- OpenAPI/Swagger endpoint documentation
- API versioning
- SDK generation
- Expanded request and response examples