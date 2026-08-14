class LoadOffer {
  final String brokerName;
  final String origin;
  final String destination;
  final double distanceMiles;
  final double offeredRate;
  final double targetRate;
  final String status; // "Countering", "Rejected", "Booked"

  LoadOffer({
    required this.brokerName,
    required this.origin,
    required this.destination,
    required this.distanceMiles,
    required this.offeredRate,
    required this.targetRate,
    required this.status,
  });
}

class FreightBotSession {
  final String status; // "Scanning DAT Load Board...", "Actively Negotiating", "Load Secured"
  final double driverMinimumRatePerMile;
  final int activeNegotiations;
  final int rejectedOffers;
  final LoadOffer? securedLoad;
  final List<LoadOffer> negotiationLog;

  FreightBotSession({
    required this.status,
    required this.driverMinimumRatePerMile,
    required this.activeNegotiations,
    required this.rejectedOffers,
    this.securedLoad,
    required this.negotiationLog,
  });
}
