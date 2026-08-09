import 'dart:async';
import '../models/carbon_credit_model.dart';

class EcoDrivingService {
  Future<Map<String, dynamic>> fetchDriverEcoWallet() async {
    await Future.delayed(const Duration(seconds: 2));
    
    return {
      'totalTokens': 1450,
      'lifetimeCo2SavedKg': 842.5,
      'currentTier': 'Platinum Eco-Driver',
      'recentTrips': [
        EcoTripData(
          tripId: 'TRP-1092',
          gallonsSaved: 4.2,
          co2EmissionsAvoidedKg: 42.8,
          earnedCarbonTokens: 120,
          drivingBehavior: 'Excellent Coasting',
          tripDate: DateTime.now().subtract(const Duration(days: 1)),
        ),
        EcoTripData(
          tripId: 'TRP-1091',
          gallonsSaved: 1.8,
          co2EmissionsAvoidedKg: 18.3,
          earnedCarbonTokens: 45,
          drivingBehavior: 'Reduced Idling',
          tripDate: DateTime.now().subtract(const Duration(days: 2)),
        ),
      ]
    };
  }
}
