class FreightLoad {
  final String loadId;
  final String origin;
  final String destination;
  final int miles;
  final double payout;
  final double ratePerMile;
  final String equipmentType;
  final String weightLbs;

  FreightLoad({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.miles,
    required this.payout,
    required this.ratePerMile,
    required this.equipmentType,
    required this.weightLbs,
  });
}

class SwipableSession {
  final String status;
  final List<FreightLoad> pendingLoads;
  final List<FreightLoad> acceptedLoads;
  final List<FreightLoad> rejectedLoads;

  SwipableSession({
    required this.status,
    required this.pendingLoads,
    required this.acceptedLoads,
    required this.rejectedLoads,
  });
}
