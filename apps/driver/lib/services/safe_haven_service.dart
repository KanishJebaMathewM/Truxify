import 'dart:async';
import '../models/safe_haven_model.dart';

class SafeHavenService {
  final _sessionController = StreamController<SafeHavenSession>.broadcast();
  
  Stream<SafeHavenSession> get havenStream => _sessionController.stream;

  void initializeRouting() {
    _emitState('Standard Commercial Routing Active', false, [], [], 0.0, false);
  }

  void toggleHazmatMode(bool isActive) async {
    if (!isActive) {
      _emitState('Standard Commercial Routing Active', false, [], [], 0.0, false);
      return;
    }

    _emitState('Querying Federal Spatial Database...', true, [], [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Recalculating Path to Avoid Tunnels...', true, [], [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));

    List<RouteRestriction> avoided = [
      RouteRestriction(featureName: 'Eisenhower Tunnel', location: 'I-70 West, CO', restrictionType: 'Tunnel', penalty: '\$10,000 Federal Fine'),
      RouteRestriction(featureName: 'Denver City Center', location: 'Downtown Denver', restrictionType: 'City Center', penalty: '\$5,000 Local Fine'),
    ];

    List<SafeHaven> havens = [
      SafeHaven(havenName: 'Federal Safe Haven #41', location: 'Exit 205, Silverthorne', hasSecurity: true, distanceDetourMiles: 14),
      SafeHaven(havenName: 'Hazmat Authorized Rest Area', location: 'Mile Marker 215', hasSecurity: false, distanceDetourMiles: 4),
    ];

    _emitState('Hazmat Compliance Routing Active', true, avoided, havens, 42.5, false);
  }

  void _emitState(String status, bool hazmat, List<RouteRestriction> hazards, List<SafeHaven> havens, double detour, bool isRecalculating) {
    _sessionController.add(SafeHavenSession(
      status: status,
      hazmatModeActive: hazmat,
      avoidedHazards: List.from(hazards),
      certifiedHavens: List.from(havens),
      addedDetourMiles: detour,
      isRecalculating: isRecalculating,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
