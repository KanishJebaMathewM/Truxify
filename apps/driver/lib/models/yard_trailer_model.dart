class YardTrailer {
  final String trailerId;
  final String yardSpot; // e.g. 'A-45', 'B-12'
  final String status; // 'EMPTY', 'LOADED', 'MAINTENANCE'
  final DateTime lastScanned;
  final bool isVerifiedByDrone;
  final String? scannedBarcodeUrl; // Mock URL for the drone snapshot

  YardTrailer({
    required this.trailerId,
    required this.yardSpot,
    required this.status,
    required this.lastScanned,
    required this.isVerifiedByDrone,
    this.scannedBarcodeUrl,
  });
}
