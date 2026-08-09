class PlatoonMatch {
  final String driverName;
  final String truckId;
  final String commonRouteSegment; // e.g., 'I-40 East (280 miles)'
  final int milesToMergePoint;
  final int estimatedFuelSavingsPercent;
  final String status; // 'Available', 'Requested', 'Linked'

  PlatoonMatch({
    required this.driverName,
    required this.truckId,
    required this.commonRouteSegment,
    required this.milesToMergePoint,
    required this.estimatedFuelSavingsPercent,
    required this.status,
  });
}
