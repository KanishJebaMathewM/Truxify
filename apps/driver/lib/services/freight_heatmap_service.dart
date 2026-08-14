import 'dart:async';
import '../models/freight_heatmap_model.dart';

class FreightHeatmapService {
  final _sessionController = StreamController<HeatmapSession>.broadcast();

  Stream<HeatmapSession> get heatmapStream => _sessionController.stream;

  void fetchPredictiveData(String trailerType) async {
    _sessionController.add(HeatmapSession(
      status: 'Analyzing Historical & Seasonal Pricing Data...',
      selectedTrailerType: trailerType,
      zones: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(HeatmapSession(
      status: '7-Day Predictive Forecast Generated',
      selectedTrailerType: trailerType,
      zones: [
        HeatmapZone(zoneName: 'Midwest (Chicago)', currentAvgRatePerMile: 2.15, predictedRatePerMile: 2.85, daysInFuture: 7, trend: 'Surging', colorHex: 'FF4500'), // Orange/Red for hot
        HeatmapZone(zoneName: 'Southeast (Atlanta)', currentAvgRatePerMile: 1.95, predictedRatePerMile: 2.05, daysInFuture: 7, trend: 'Stable', colorHex: 'FFA500'), // Orange
        HeatmapZone(zoneName: 'West Coast (LA)', currentAvgRatePerMile: 2.40, predictedRatePerMile: 1.70, daysInFuture: 7, trend: 'Crashing', colorHex: '0000FF'), // Blue for cold
        HeatmapZone(zoneName: 'Northeast (NYC)', currentAvgRatePerMile: 3.10, predictedRatePerMile: 3.25, daysInFuture: 7, trend: 'Surging', colorHex: 'FF0000'), // Red for very hot
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
