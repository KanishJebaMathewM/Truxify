class GeohashLocation {
  final String geohash;
  final DateTime timestamp;
  final double speedMph;

  GeohashLocation({
    required this.geohash,
    required this.timestamp,
    required this.speedMph,
  });

  Map<String, dynamic> toJson() => {
    'g': geohash,
    't': timestamp.millisecondsSinceEpoch,
    's': speedMph,
  };
}
