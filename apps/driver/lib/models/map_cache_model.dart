class RouteCorridor {
  final String routeId;
  final String origin;
  final String destination;
  final int totalTilesRequired;
  final double estimatedSizeMb;

  RouteCorridor({
    required this.routeId,
    required this.origin,
    required this.destination,
    required this.totalTilesRequired,
    required this.estimatedSizeMb,
  });
}

class MapCacheSession {
  final String status;
  final RouteCorridor? activeCorridor;
  final int tilesDownloaded;
  final bool isCachingComplete;
  final bool isOfflineModeSimulated;

  MapCacheSession({
    required this.status,
    this.activeCorridor,
    required this.tilesDownloaded,
    required this.isCachingComplete,
    required this.isOfflineModeSimulated,
  });
  
  double get downloadProgress => activeCorridor == null ? 0 : (tilesDownloaded / activeCorridor!.totalTilesRequired).clamp(0.0, 1.0);
}
