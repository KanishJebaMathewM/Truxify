import 'dart:async';
import '../models/freight_rate_forecast_model.dart';

class RateForecastingService {
  Future<FreightLaneForecast> getForecastForLane(String origin, String destination) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate API call

    final today = DateTime.now();

    return FreightLaneForecast(
      origin: origin,
      destination: destination,
      currentLoadToTruckRatio: 4.2, // 4.2 loads per truck
      marketCondition: 'Tight',
      sevenDayForecast: [
        DailyRateForecast(date: today, predictedRatePerMile: 2.85, trend: 'Stable', confidenceIntervalHigh: 2.90, confidenceIntervalLow: 2.80),
        DailyRateForecast(date: today.add(const Duration(days: 1)), predictedRatePerMile: 2.92, trend: 'Up', confidenceIntervalHigh: 3.00, confidenceIntervalLow: 2.85),
        DailyRateForecast(date: today.add(const Duration(days: 2)), predictedRatePerMile: 3.05, trend: 'Up', confidenceIntervalHigh: 3.15, confidenceIntervalLow: 2.95),
        DailyRateForecast(date: today.add(const Duration(days: 3)), predictedRatePerMile: 3.10, trend: 'Stable', confidenceIntervalHigh: 3.20, confidenceIntervalLow: 3.00),
        DailyRateForecast(date: today.add(const Duration(days: 4)), predictedRatePerMile: 2.95, trend: 'Down', confidenceIntervalHigh: 3.05, confidenceIntervalLow: 2.85),
        DailyRateForecast(date: today.add(const Duration(days: 5)), predictedRatePerMile: 2.75, trend: 'Down', confidenceIntervalHigh: 2.85, confidenceIntervalLow: 2.65),
        DailyRateForecast(date: today.add(const Duration(days: 6)), predictedRatePerMile: 2.70, trend: 'Stable', confidenceIntervalHigh: 2.80, confidenceIntervalLow: 2.60),
      ],
    );
  }
}
