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