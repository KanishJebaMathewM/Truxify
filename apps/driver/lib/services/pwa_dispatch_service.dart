import 'dart:async';
import '../models/pwa_dispatch_model.dart';

class PwaDispatchService {
  final _sessionController = StreamController<PwaDispatchSession>.broadcast();
  bool _isInstalled = false;
  bool _isOffline = false;

  Stream<PwaDispatchSession> get pwaStream => _sessionController.stream;

  void initializeBoard() async {
    _emitState('Prompting');
  }

  void installPwa() async {
    _isInstalled = true;
    _emitState('Installed');
    
    // Simulate caching assets
    await Future.delayed(const Duration(seconds: 2));
    _isOffline = true;
    _emitState('Installed');
  }
  
  void declineInstall() {
    _emitState('Not Installed');
  }

  void _emitState(String installState) {
    _sessionController.add(PwaDispatchSession(
      pwaInstallState: installState,
      isOfflineReady: _isOffline,
      activeFleet: [
        DispatchTruck(truckId: 'TRK-990', driverName: 'John Adams', status: 'In Transit', location: 'Dallas, TX', currentRevenue: 4500.0),
        DispatchTruck(truckId: 'TRK-812', driverName: 'Sarah Miller', status: 'Available', location: 'Atlanta, GA', currentRevenue: 0.0),
        DispatchTruck(truckId: 'TRK-771', driverName: 'Mike Davis', status: 'Offline', location: 'Denver, CO', currentRevenue: 3100.0),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
