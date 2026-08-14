class LumperReceipt {
  final String loadId;
  final String warehouseName;
  final double amountPaid;
  final String dateScanned;
  final String ocrConfidence;
  
  LumperReceipt({
    required this.loadId,
    required this.warehouseName,
    required this.amountPaid,
    required this.dateScanned,
    required this.ocrConfidence,
  });
}

class ReimbursementTicket {
  final String ticketId;
  final String brokerApiEndpoint;
  final String status;
  final String timestamp;

  ReimbursementTicket({
    required this.ticketId,
    required this.brokerApiEndpoint,
    required this.status,
    required this.timestamp,
  });
}

class LumperFeeSession {
  final String status;
  final LumperReceipt? scannedReceipt;
  final ReimbursementTicket? activeTicket;
  final bool isProcessing;

  LumperFeeSession({
    required this.status,
    this.scannedReceipt,
    this.activeTicket,
    required this.isProcessing,
  });
}
