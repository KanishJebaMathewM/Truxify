# 🔄 Offline Sync Architecture Specification

This document details the offline synchronization architecture, batch payload schema, local caching mechanics, and conflict resolution strategy for Truxify driver and customer mobile applications operating in areas with poor or intermittent cellular connectivity.

---

## 🏗️ Architectural Overview

When mobile network connectivity drops, the Truxify Flutter application transitions into **Offline Mode**. Critical telemetry pings, trip milestone state updates, and proof-of-delivery (PoD) signatures are buffered locally in an encrypted **SQLite / Hive** database queue. 

Once network connectivity is restored, the client initiates a background sync request (`POST /api/sync/batch`) to drain the offline payload queue.

---

## 📦 Batch Payload Schema

```json
{
  "device_id": "uuid-device-identifier",
  "driver_id": "uuid-driver-id",
  "synced_at": "2026-07-26T09:30:00.000Z",
  "client_version": "1.4.2",
  "events": [
    {
      "event_id": "evt_98234792384",
      "event_type": "LOCATION_PING",
      "timestamp": "2026-07-26T09:15:22.120Z",
      "payload": {
        "order_id": "ord_102938",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "speed_kmh": 45.2,
        "heading_deg": 180.0,
        "battery_level": 85
      }
    },
    {
      "event_id": "evt_98234792385",
      "event_type": "STATUS_UPDATE",
      "timestamp": "2026-07-26T09:20:00.000Z",
      "payload": {
        "order_id": "ord_102938",
        "status": "arrived_at_destination",
        "otp_code": "582910"
      }
    }
  ]
}
```

---

## ⚔️ Conflict Resolution Protocol

To prevent TOCTOU (Time-of-Check to Time-of-Use) race conditions when syncing delayed offline state transitions, Truxify enforces the following rules:

1. **State Machine Linear Transition Check**:
   - Order statuses can only progress monotonically (`created` $\rightarrow$ `assigned` $\rightarrow$ `in_transit` $\rightarrow$ `arrived` $\rightarrow$ `delivered`). Out-of-order stale transitions are ignored.
2. **Idempotency Keys (`event_id`)**:
   - Every offline event includes a client-generated UUID (`event_id`). The backend uses Redis deduplication (`EXPIRE 86400`) to guarantee exact-once processing.
3. **Server Timestamp Precedence for Financial Escrow**:
   - While telemetry locations use device timestamps, financial escrow releases and OTP verifications require server-side consensus timestamp validation.
