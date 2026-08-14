class ParkingLocation {
  final String locationName;
  final String locationType; // "Abandoned Mall", "Secured Truck Stop"
  final double latitude;
  final double longitude;
  final int securityScore; // 0-100
  final bool hasFencing;
  final bool hasGuards;

  ParkingLocation({
    required this.locationName,
    required this.locationType,
    required this.latitude,
    required this.longitude,
    required this.securityScore,
    required this.hasFencing,
    required this.hasGuards,
  });
}

class CargoTheftSession {
  final String driverLocation;
  final String status; // "Searching for Parking...", "CRITICAL: CARGO THEFT BLACKSPOT DETECTED"
  final ParkingLocation? selectedLocation;
  final int recentTheftsInArea; // e.g. 14 in last week
  final bool isSafeZone;

  CargoTheftSession({
    required this.driverLocation,
    required this.status,
    this.selectedLocation,
    required this.recentTheftsInArea,
    required this.isSafeZone,
  });
}
