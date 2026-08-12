class EvChargerLocation {
  final String stationName;
  final String address;
  final double distanceMiles;
  final String chargerType; // "1 Megawatt MCS", "350kW CCS"
  final int availableBays;
  final bool isReserved;

  EvChargerLocation({
    required this.stationName,
    required this.address,
    required this.distanceMiles,
    required this.chargerType,
    required this.availableBays,
    required this.isReserved,
  });
}

class EvRoutingSession {
  final double currentSocPct; // State of Charge
  final double payloadWeightLbs;
  final double projectedRangeMiles;
  final String status; // "Cruising", "Calculating Energy Burn", "Charger Reserved"
  final EvChargerLocation? nextCharger;

  EvRoutingSession({
    required this.currentSocPct,
    required this.payloadWeightLbs,
    required this.projectedRangeMiles,
    required this.status,
    this.nextCharger,
  });
}
