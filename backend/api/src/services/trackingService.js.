// Example inside a tracking service method (e.g., updateDriverLocation or recordTelemetry)
try {
  // ... core tracking / GPS update logic ...
} catch (err) {
  logger.error({
    event: 'TRACKING_ERROR',
    error: err.message,
    stack: err.stack,
    requestId: req?.id || requestId,
    driverId: driverId,
    orderId: orderId,
  }, 'Failed to process driver location tracking update');
  
  throw err; // or return structured failure depending on service pattern
}
