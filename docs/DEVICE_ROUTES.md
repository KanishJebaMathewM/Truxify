# Device Routes

Endpoints for registering and unregistering push-notification devices.

## POST /api/devices/register

Registers a device's FCM token.

```json
{ "token": "fcm-token", "platform": "android" }
```

`token` must be a string of 10-1024 characters. Rate limited per device.

## DELETE /api/devices/unregister

Removes a device token (call on logout).

```json
{ "token": "fcm-token" }
```

## GET /api/devices/platforms

Returns the list of registered device platforms.

All endpoints require authentication. See also `POST /api/users/fcm-token`
in `userRoutes` for updating the user-profile FCM token.
