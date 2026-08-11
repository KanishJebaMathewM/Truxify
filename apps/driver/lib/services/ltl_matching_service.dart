import 'dart:async';
import '../models/ltl_load_model.dart';

class LtlMatchingService {
  Future<List<LtlLoad>> findCompatibleLtlLoads(int availableSpaces, int maxWeight) async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      LtlLoad(
        loadId: 'LTL-8821',
        pickupLocation: 'St. Louis, MO',
        dropoffLocation: 'Indianapolis, IN',
        weightLbs: 4500,
        requiredPalletSpaces: 4,
        payout: 650.00,
        addedMiles: 12,
        matchScore: 98.5,
      ),
      LtlLoad(
        loadId: 'LTL-9012',
        pickupLocation: 'Effingham, IL',
        dropoffLocation: 'Columbus, OH',
        weightLbs: 2200,
        requiredPalletSpaces: 2,
        payout: 320.00,
        addedMiles: 4,
        matchScore: 95.0,
      ),
      LtlLoad(
        loadId: 'LTL-7743',
        pickupLocation: 'Terre Haute, IN',
        dropoffLocation: 'Cincinnati, OH',
        weightLbs: 8000,
        requiredPalletSpaces: 8,
        payout: 900.00,
        addedMiles: 35,
        matchScore: 72.0,
      ),
    ];
  }
}
