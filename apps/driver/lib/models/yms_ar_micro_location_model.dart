class YardLocation {
  final double latitude;
  final double longitude;
  final String slotId; // e.g. "Row G, Slot 42"

  YardLocation({
    required this.latitude,
    required this.longitude,
    required this.slotId,
  });
}

class TrailerMicroLocation {
  final String trailerId;
  final String type; // e.g. "53' Dry Van"
  final YardLocation exactLocation;
  final DateTime droppedAt;
  final String droppedByDriverId;

  TrailerMicroLocation({
    required this.trailerId,
    required this.type,
    required this.exactLocation,
    required this.droppedAt,
    required this.droppedByDriverId,
  });
}
