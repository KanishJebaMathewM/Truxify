class EvChargingStation {
  final String stationId;
  final String stationName;
  final double distanceMiles;
  final int totalMegawattBays;
  final int availableBays;
  final double kwPrice;
  final bool isClass8Compatible;
  final String estimatedWaitTime;

  EvChargingStation({
    required this.stationId,
    required this.stationName,
    required this.distanceMiles,
    required this.totalMegawattBays,
    required this.availableBays,
    required this.kwPrice,
    required this.isClass8Compatible,
    required this.estimatedWaitTime,
  });
}

class EvReservation {
  final String reservationId;
  final EvChargingStation station;
  final DateTime reservedTime;
  final String status;

  EvReservation({
    required this.reservationId,
    required this.station,
    required this.reservedTime,
    required this.status,
  });
}
