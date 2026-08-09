class RouteStop {
  final String id;
  final String address;
  final double latitude;
  final double longitude;
  final DateTime deliveryWindowStart;
  final DateTime deliveryWindowEnd;
  final bool isOptimized;

  RouteStop({
    required this.id,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.deliveryWindowStart,
    required this.deliveryWindowEnd,
    this.isOptimized = false,
  });
}
