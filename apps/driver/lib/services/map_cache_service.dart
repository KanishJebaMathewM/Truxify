import 'dart:async';
import '../models/map_cache_model.dart';

class MapCacheService {
  final _sessionController = StreamController<MapCacheSession>.broadcast();
  Timer? _downloadTimer;
  
  RouteCorridor? _corridor;
  int _downloaded = 0;
  bool _isComplete = false;
  bool _isOffline = false;

  Stream<MapCacheSession> get cacheStream => _sessionController.stream;

  void initializeManager() {
    _emitState('Awaiting Route Acceptance');
  }

  void acceptLoadAndStartCache() {
    _corridor = RouteCorridor(
      routeId: 'RT-8812',
      origin: 'Chicago, IL',
      destination: 'Los Angeles, CA',
      totalTilesRequired: 2400,
      estimatedSizeMb: 48.5, // Much smaller than 10GB for the whole US
    );
    _downloaded = 0;
    _isComplete = false;
    
    _emitState('Calculating 5-Mile Buffer Corridor...');
    
    Future.delayed(const Duration(seconds: 1), () {
      _startDownloading();
    });
  }

  void _startDownloading() {
    _downloadTimer?.cancel();
    _downloadTimer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      _downloaded += 45;
      if (_downloaded >= _corridor!.totalTilesRequired) {
        _downloaded = _corridor!.totalTilesRequired;
        _isComplete = true;
        timer.cancel();
        _emitState('Pre-emptive Caching Complete');
      } else {
        _emitState('Downloading Vector Tiles (Wi-Fi)');
      }
    });
  }

  void toggleSimulateDeadZone() {
    _isOffline = !_isOffline;
    if (_isOffline) {
      _emitState('DEAD ZONE: Serving Map from Local Cache');
    } else {
      _emitState(_isComplete ? 'Pre-emptive Caching Complete' : 'Network Restored');
    }
  }

  void _emitState(String status) {
    _sessionController.add(MapCacheSession(
      status: status,
      activeCorridor: _corridor,
      tilesDownloaded: _downloaded,
      isCachingComplete: _isComplete,
      isOfflineModeSimulated: _isOffline,
    ));
  }

  void dispose() {
    _downloadTimer?.cancel();
    _sessionController.close();
  }
}
