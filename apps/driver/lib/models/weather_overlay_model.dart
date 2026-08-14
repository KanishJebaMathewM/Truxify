class RouteSegment {
  final String id;
  final String startLocation;
  final String endLocation;
  final int miles;
  final bool intersectsWeather;
  final String? warningType;

  RouteSegment({
    required this.id,
    required this.startLocation,
    required this.endLocation,
    required this.miles,
    required this.intersectsWeather,
    this.warningType,
  });
}

class WeatherOverlaySession {
  final String status;
  final String mapRegion;
  final List<RouteSegment> segments;
  final int totalSafeMiles;
  final int totalHazardMiles;

  WeatherOverlaySession({
    required this.status,
    required this.mapRegion,
    required this.segments,
    required this.totalSafeMiles,
    required this.totalHazardMiles,
  });
}
