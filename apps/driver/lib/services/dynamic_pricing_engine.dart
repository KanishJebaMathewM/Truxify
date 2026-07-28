import 'dart:math';
import '../models/pricing_insight_model.dart';

class DynamicPricingEngine {
  /// Simulates an ML pricing model that determines the optimal bid
  /// based on current lane data, load-to-truck ratios, and diesel prices.
  Future<PricingInsight> analyzeLoadPricing({
    required String loadId,
    required String origin,
    required String destination,
    required double totalMiles,
  }) async {
    // Simulate API delay for ML model execution
    await Future.delayed(const Duration(seconds: 2));

    final random = Random();

    // Base market rate simulation ($2.10 to $2.80 per mile)
    final baseRatePerMile = 2.10 + random.nextDouble() * 0.70;
    
    // Simulate a fluctuating fuel surcharge based on current diesel prices
    final fuelSurchargePerMile = 0.40 + random.nextDouble() * 0.20; 

    final marketAverage = (baseRatePerMile + fuelSurchargePerMile) * totalMiles;

    // AI suggestion slightly optimizes the bid based on the current load-to-truck ratio
    // If the ratio favors trucks (fewer trucks, more loads), suggest a slightly higher bid
    final loadToTruckRatioFactor = 0.95 + random.nextDouble() * 0.15; // 0.95 to 1.10
    final suggestedBid = marketAverage * loadToTruckRatioFactor;

    return PricingInsight(
      loadId: loadId,
      suggestedBid: suggestedBid,
      marketAverage: marketAverage,
      fuelSurchargeEstimate: fuelSurchargePerMile * totalMiles,
      probabilityOfWinning: 0.85, // 85% confidence score in this suggestion
      laneOrigin: origin,
      laneDestination: destination,
    );
  }
}
