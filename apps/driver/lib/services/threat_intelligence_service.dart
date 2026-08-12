import 'dart:async';
import '../models/cargo_theft_risk_model.dart';

class ThreatIntelligenceService {
  Future<List<ThreatZone>> getActiveThreatZones() async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate API call to threat feed

    return [
      ThreatZone(
        locationName: 'I-55 South Truck Stop, Memphis',
        latitude: 35.1495,
        longitude: -90.0490,
        riskLevel: 'Critical',
        recentIncidents: [
          'Organized trailer break-in (Electronics) - 2 days ago',
          'Driver held at gunpoint - 5 days ago'
        ],
        intelSource: 'CargoNet & Dark Web Chatter API',
      ),
      ThreatZone(
        locationName: 'West Memphis Weigh Station Bypass',
        latitude: 35.1450,
        longitude: -90.1830,
        riskLevel: 'High',
        recentIncidents: [
          'Fictitious pickup attempt (Pharmaceuticals) - 1 week ago'
        ],
        intelSource: 'Supply Chain Intel Feed',
      ),
      ThreatZone(
        locationName: 'Marion Rest Area',
        latitude: 35.2100,
        longitude: -90.2000,
        riskLevel: 'Medium',
        recentIncidents: [
          'Fuel siphoning reported - 3 days ago'
        ],
        intelSource: 'Local PD Crime API',
      ),
    ];
  }
}
