class ParkingSpotHandoff {
  final String locationName;
  final String gpsCoordinates;
  final String departingDriver;
  final DateTime expectedDepartureTime;
  final String spotType; // 'Pull-through', 'Back-in'
  final bool hasHookups; // Shore power/APU
  final String status; // 'Available', 'Reserved', 'Handed Off'

  ParkingSpotHandoff({
    required this.locationName,
    required this.gpsCoordinates,
    required this.departingDriver,
    required this.expectedDepartureTime,
    required this.spotType,
    required this.hasHookups,
    required this.status,
  });
}
