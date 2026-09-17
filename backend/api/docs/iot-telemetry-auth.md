# IoT Telemetry Authentication & Authorization

## Overview
The Truxify cold-chain IoT system allows autonomous sensors (e.g., temperature/humidity loggers) to POST telemetry readings to specific freight loads. These readings trigger automated alerts if the cargo environment breaches safe thresholds.

## The Problem: UUID Space Mismatch (Issue #10502)
Previously, the authorization logic for `iot_device` roles contained a critical flaw:
```javascript
// BROKEN LOGIC
if (req.user.role === 'iot_device') {
  isAuthorized = req.user.id === loadId; 
}
```
- `req.user.id` is the **device's profile UUID** (from the `profiles` table).
- `loadId` is the **load offer UUID** (from the `load_offers` table).

These two identifiers exist in completely different UUID spaces and can never be equal. As a result, every legitimate IoT device was permanently denied (403 Forbidden) when attempting to submit telemetry. Additionally, the GET route lacked an `iot_device` branch entirely, preventing devices from reading their own history.

## The Solution: Device-to-Load Mapping
To fix this, we established a formal mapping between devices and loads.

### 1. Database Schema Update
The `load_offers` table now includes a `device_id` column (UUID, nullable) that references the `profiles.id` of the provisioned IoT device assigned to that shipment.

```sql
ALTER TABLE load_offers 
ADD COLUMN device_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_load_offers_device_id ON load_offers(device_id);
```

### 2. Authorization Logic Update
The `iotRoutes.js` handlers now compare the authenticated device's profile ID against the load's assigned `device_id`:

```javascript
// FIXED LOGIC
if (req.user.role === 'iot_device') {
  isAuthorized = load.device_id === req.user.id;
}
```

### 3. GET Route Parity
The GET `/api/iot/telemetry/:id` route now includes the same `iot_device` branch, allowing sensors to verify their uploaded history.

## Security Considerations
- **Device Provisioning**: Devices are provisioned by admins or customers. A device can only be assigned to one active load at a time.
- **No Cross-Load Access**: A device assigned to Load A cannot read or write telemetry for Load B, even if both loads belong to the same customer.
- **Alert Triggering**: Cold-chain alerts (e.g., temperature breaches) are only triggered if the telemetry ingestion succeeds. The previous 403 errors meant alerts were never firing from device data.

## API Usage for Device Firmware
When configuring IoT firmware, use the device's JWT to authenticate:

```http
POST /api/iot/telemetry/{load_id}
Authorization: Bearer <device_jwt>
Content-Type: application/json

{
  "temperature": 4.5,
  "humidity": 60,
  "timestamp": "2026-09-17T12:00:00Z"
}
```
