import 'dart:async';
import '../models/detention_estimator_model.dart';

class DetentionEstimatorService {
  final _sessionController = StreamController<DetentionEstimatorSession>.broadcast();

  Stream<DetentionEstimatorSession> get detentionStream => _sessionController.stream;

  void analyzeGeofenceData() async {
    _sessionController.add(DetentionEstimatorSession(
      status: 'Aggregating Fleet Geofence Data...',
      facilities: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(DetentionEstimatorSession(
      status: 'Facility Intelligence Updated',
      facilities: [
        FacilityDetentionStats(facilityName: 'Acme Cold Storage', location: 'Chicago, IL', averageWaitHours: 6.5, totalGeofenceVisits: 1420, trend: 'Worsening'),
        FacilityDetentionStats(facilityName: 'National Grocers Dist.', location: 'Atlanta, GA', averageWaitHours: 4.2, totalGeofenceVisits: 850, trend: 'Stable'),
        FacilityDetentionStats(facilityName: 'Prime Logistics Hub', location: 'Dallas, TX', averageWaitHours: 1.5, totalGeofenceVisits: 2100, trend: 'Improving'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
