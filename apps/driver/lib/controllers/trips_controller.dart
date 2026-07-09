import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/app_models.dart';
import '../services/trip_service.dart';

final tripsControllerProvider = ChangeNotifierProvider((ref) => TripsController());

class TripsController extends ChangeNotifier {
  final TripService _tripService = TripService();

  List<Map<String, dynamic>> trips = [];
  bool isLoading = false;
  String? error;

  Future<void> fetchTrips() async {
    isLoading = true;
    error = null;
    notifyListeners();

    try {
      final result = await _tripService.fetchTripHistory(limit: 20);
      trips = result['trips'] as List<Map<String, dynamic>>;
    } catch (e) {
      error = e.toString();
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  int parseEarnings(String earnings) {
    final clean = earnings.replaceAll(RegExp(r'[^\d]'), '');
    return int.tryParse(clean) ?? 0;
  }

  int totalEarningsPaise() => trips.fold(
        0,
        (sum, row) => sum + ((row['net_earnings'] ?? 0) as num).toInt(),
      );

  int completedCount() =>
      trips.where((r) => r['status'] == 'completed').length;

  double completionRate() {
    final total = trips.length;
    if (total == 0) return 0;
    return (completedCount() / total) * 100;
  }

  String formatEarnings(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(1)}L';
    } else if (rupees >= 1000) {
      return '₹${(rupees / 1000).toStringAsFixed(1)}K';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }
}
