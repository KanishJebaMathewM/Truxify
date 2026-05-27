import '../data/mock_data.dart';
import '../models/app_models.dart';

class EarningsDataService {
  /// Simulates async loading of earnings data with a short delay.
  /// Returns the weekly earnings list.
  static Future<List<EarningDay>> fetchWeeklyEarnings(
      {Duration delay = const Duration(milliseconds: 600)}) async {
    await Future.delayed(delay);
    // Simulate occasional failure (10% chance)
    if (DateTime.now().millisecondsSinceEpoch % 10 == 0) {
      throw Exception('Failed to load earnings data. Please try again.');
    }
    return weeklyEarnings;
  }

  static Future<List<PendingPayment>> fetchPendingPayments(
      {Duration delay = const Duration(milliseconds: 400)}) async {
    await Future.delayed(delay);
    return pendingPayments;
  }

  /// Compute derived stats from weekly earnings
  static EarningsStats computeStats(List<EarningDay> earnings) {
    final totalAmount = earnings.fold<int>(0, (sum, e) => sum + e.amount);
    final totalTrips = earnings.fold<int>(0, (sum, e) => sum + e.tripCount);
    final avgPerTrip = totalTrips > 0 ? totalAmount / totalTrips : 0.0;
    return EarningsStats(
      totalAmount: totalAmount,
      totalTrips: totalTrips,
      avgPerTrip: avgPerTrip,
      totalHours: totalTrips * 5, // approximate: 5h per trip
    );
  }
}

class EarningsStats {
  final int totalAmount;
  final int totalTrips;
  final double avgPerTrip;
  final int totalHours;

  const EarningsStats({
    required this.totalAmount,
    required this.totalTrips,
    required this.avgPerTrip,
    required this.totalHours,
  });
}
