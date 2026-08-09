class CustomerNotification {
  final String loadId;
  final String facilityName;
  final String triggerEvent; // e.g. '50_MILES_OUT', '10_MILES_OUT', 'ARRIVED'
  final DateTime triggeredAt;
  final String status; // e.g. 'SENT', 'FAILED'
  final String messageBody;

  CustomerNotification({
    required this.loadId,
    required this.facilityName,
    required this.triggerEvent,
    required this.triggeredAt,
    required this.status,
    required this.messageBody,
  });
}
