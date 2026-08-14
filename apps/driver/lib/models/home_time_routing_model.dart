class RoutingLeg {
  final int sequenceNumber;
  final String origin;
  final String destination;
  final double payout;
  final double miles;
  final String estimatedArrival;

  RoutingLeg({
    required this.sequenceNumber,
    required this.origin,
    required this.destination,
    required this.payout,
    required this.miles,
    required this.estimatedArrival,
  });
}

class HomeTimeRouteSession {
  final String status;
  final String driverName;
  final String homeZipCode;
  final DateTime targetHomeDate;
  final List<RoutingLeg> optimizedSequence;
  final double totalSequencePayout;
  final bool isComputing;

  HomeTimeRouteSession({
    required this.status,
    required this.driverName,
    required this.homeZipCode,
    required this.targetHomeDate,
    required this.optimizedSequence,
    required this.totalSequencePayout,
    required this.isComputing,
  });
}
