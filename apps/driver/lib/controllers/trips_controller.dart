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
    final cleaned = earnings
        .replaceAll('₹', '')
        .replaceAll(',', '')
        .trim();
    final match = RegExp(r'^([\d.]+)\s*([KkLlMm]?)$').firstMatch(cleaned);
    if (match == null) return 0;
    final value = double.tryParse(match.group(1) ?? '') ?? 0;
    final suffix = match.group(2)?.toUpperCase() ?? '';
    if (suffix == 'K') return (value * 1000 * 100).toInt();
    if (suffix == 'L') return (value * 100000 * 100).toInt();
    if (suffix == 'M') return (value * 1000000 * 100).toInt();
    return (value * 100).toInt();
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
