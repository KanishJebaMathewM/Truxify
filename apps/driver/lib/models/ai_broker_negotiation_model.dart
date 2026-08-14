class NegotiationSession {
  final String loadId;
  final String brokerName;
  final String origin;
  final String destination;
  final double initialBrokerOfferUsd;
  final double driverMinimumUsd;
  final String status; // "Negotiating", "Accepted", "Rejected"
  final List<NegotiationMessage> history;

  NegotiationSession({
    required this.loadId,
    required this.brokerName,
    required this.origin,
    required this.destination,
    required this.initialBrokerOfferUsd,
    required this.driverMinimumUsd,
    required this.status,
    required this.history,
  });
}

class NegotiationMessage {
  final String sender; // "AI Bot" or "Broker"
  final String text;
  final double? offerAmountUsd;
  final DateTime timestamp;

  NegotiationMessage({
    required this.sender,
    required this.text,
    this.offerAmountUsd,
    required this.timestamp,
  });
}
