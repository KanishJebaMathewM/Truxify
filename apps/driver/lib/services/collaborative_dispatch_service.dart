import 'dart:async';
import 'dart:math';
import '../models/collaborative_dispatch_model.dart';

class CollaborativeDispatchService {
  final _sessionController = StreamController<CollaborativeDispatchSession>.broadcast();
  Timer? _mockWSTimer;
  
  final List<DispatchCursor> _cursors = [
    DispatchCursor(userId: 'U1', userName: 'Alice', colorHex: '0xFFE91E63', xOffset: 50.0, yOffset: 100.0),
    DispatchCursor(userId: 'U2', userName: 'Bob', colorHex: '0xFF2196F3', xOffset: 200.0, yOffset: 300.0),
  ];

  final List<DispatchLoadItem> _loads = [
    DispatchLoadItem(loadId: 'LD-990', origin: 'Dallas, TX', destination: 'Chicago, IL'),
    DispatchLoadItem(loadId: 'LD-991', origin: 'Houston, TX', destination: 'Atlanta, GA'),
    DispatchLoadItem(loadId: 'LD-992', origin: 'Denver, CO', destination: 'Phoenix, AZ'),
    DispatchLoadItem(loadId: 'LD-993', origin: 'Miami, FL', destination: 'New York, NY'),
  ];

  Stream<CollaborativeDispatchSession> get syncStream => _sessionController.stream;

  void connectWebSocket() async {
    _sessionController.add(CollaborativeDispatchSession(
      status: 'Connecting to WS://dispatch.truxify.io...',
      activeCursors: [],
      availableLoads: _loads,
    ));

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Connected: 3 Users Online');

    _mockWSTimer = Timer.periodic(const Duration(milliseconds: 800), (timer) {
      _simulateColleagueActivity();
    });
  }

  void _simulateColleagueActivity() {
    final rand = Random();
    
    // Simulate Bob randomly locking/unlocking a load
    if (rand.nextDouble() > 0.7) {
      int idx = rand.nextInt(_loads.length);
      var target = _loads[idx];
      
      if (!target.isLocked) {
        _loads[idx] = DispatchLoadItem(
          loadId: target.loadId, 
          origin: target.origin, 
          destination: target.destination,
          lockedByUserId: 'U2',
          lockedByUserName: 'Bob',
          lockedColorHex: '0xFF2196F3'
        );
      } else if (target.lockedByUserId == 'U2') {
        _loads[idx] = DispatchLoadItem(
          loadId: target.loadId, 
          origin: target.origin, 
          destination: target.destination,
        );
      }
    }
    _emitState('Connected: 3 Users Online');
  }

  void lockLoad(String loadId) {
    int idx = _loads.indexWhere((l) => l.loadId == loadId);
    if (idx != -1 && !_loads[idx].isLocked) {
      _loads[idx] = DispatchLoadItem(
        loadId: _loads[idx].loadId,
        origin: _loads[idx].origin,
        destination: _loads[idx].destination,
        lockedByUserId: 'ME',
        lockedByUserName: 'You',
        lockedColorHex: '0xFF4CAF50',
      );
      _emitState('Connected: 3 Users Online');
    }
  }
  
  void unlockLoad(String loadId) {
    int idx = _loads.indexWhere((l) => l.loadId == loadId);
    if (idx != -1 && _loads[idx].lockedByUserId == 'ME') {
      _loads[idx] = DispatchLoadItem(
        loadId: _loads[idx].loadId,
        origin: _loads[idx].origin,
        destination: _loads[idx].destination,
      );
      _emitState('Connected: 3 Users Online');
    }
  }

  void _emitState(String status) {
    _sessionController.add(CollaborativeDispatchSession(
      status: status,
      activeCursors: List.from(_cursors),
      availableLoads: List.from(_loads),
    ));
  }

  void dispose() {
    _mockWSTimer?.cancel();
    _sessionController.close();
  }
}
