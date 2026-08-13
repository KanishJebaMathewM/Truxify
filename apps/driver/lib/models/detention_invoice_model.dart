class DetentionEvent {
  final String facilityName;
  final String brokerEmail;
  final DateTime arrivalTime;
  final double currentWaitHours;
  final double hourlyRate;
  final bool isInvoiceGenerated;
  final double estimatedPayout;

  DetentionEvent({
    required this.facilityName,
    required this.brokerEmail,
    required this.arrivalTime,
    required this.currentWaitHours,
    required this.hourlyRate,
    required this.isInvoiceGenerated,
    required this.estimatedPayout,
  });
}

class DetentionInvoiceSession {
  final String status;
  final DetentionEvent? activeEvent;

  DetentionInvoiceSession({
    required this.status,
    this.activeEvent,
  });
}
