import '../models/predictive_eta_model.dart';

class EtaMlEngine {
  /// Calculates a predictive ETA from load, HoS, facility, weather, and traffic
  /// inputs.
  Future<PredictiveEta> calculatePredictiveEta({
    required String loadId,
    required double remainingDriveTimeHours,
    required String destinationFacilityId,
  }) async {
    throw UnsupportedError(
      'Predictive ETA is not configured. Connect the ETA model endpoint before displaying ML ETA results.',
    );
  }
}
