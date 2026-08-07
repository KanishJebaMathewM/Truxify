import 'dart:async';
import '../models/tour_optimization_model.dart';

class TourOptimizationService {
  Future<OptimizedTour> generateOptimizedTour(String homeBase) async {
    await Future.delayed(const Duration(seconds: 2));

    final now = DateTime.now();

    final leg1 = TourLeg(
      origin: homeBase,
      destination: 'Columbus, OH',
      loadedMiles: 320,
      emptyMilesToPickup: 15,
      payout: 950.00,
      pickupTime: now.add(const Duration(hours: 4)),
      deliveryTime: now.add(const Duration(hours: 10)),
    );

    final leg2 = TourLeg(
      origin: 'Columbus, OH',
      destination: 'Nashville, TN',
      loadedMiles: 380,
      emptyMilesToPickup: 22,
      payout: 1100.00,
      pickupTime: now.add(const Duration(hours: 24)),
      deliveryTime: now.add(const Duration(hours: 32)),
    );

    final leg3 = TourLeg(
      origin: 'Nashville, TN',
      destination: homeBase,
      loadedMiles: 410,
      emptyMilesToPickup: 18,
      payout: 1250.00,
      pickupTime: now.add(const Duration(hours: 48)),
      deliveryTime: now.add(const Duration(hours: 58)),
    );

    final legs = [leg1, leg2, leg3];
    final totalLoaded = legs.fold<int>(0, (sum, leg) => sum + leg.loadedMiles);
    final totalEmpty = legs.fold<int>(0, (sum, leg) => sum + leg.emptyMilesToPickup);
    final totalPayout = legs.fold<double>(0, (sum, leg) => sum + leg.payout);

    return OptimizedTour(
      homeBase: homeBase,
      legs: legs,
      totalLoadedMiles: totalLoaded,
      totalEmptyMiles: totalEmpty,
      totalPayout: totalPayout,
      emptyMilePercentage: (totalEmpty / (totalLoaded + totalEmpty)) * 100,
      durationDays: 3,
    );
  }
}
