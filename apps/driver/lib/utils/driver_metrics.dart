import '../models/app_models.dart';

class DriverMetrics {
  const DriverMetrics._();

  static DateTime? tryParseDate(String? input) {
    if (input == null) return null;
    final value = input.trim();
    if (value.isEmpty) return null;

    final iso = DateTime.tryParse(value);
    if (iso != null) return iso;

    final cleaned = value.replaceAll(',', ' ').replaceAll(RegExp(r'\s+'), ' ').trim();

    final dmy = RegExp(r'^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$').firstMatch(cleaned);
    if (dmy != null) {
      final day = int.tryParse(dmy.group(1) ?? '');
      final month = _monthNumber(dmy.group(2));
      final year = int.tryParse(dmy.group(3) ?? '');
      if (day == null || month == null || year == null) return null;
      return DateTime(year, month, day);
    }

    final mdy = RegExp(r'^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$').firstMatch(cleaned);
    if (mdy != null) {
      final month = _monthNumber(mdy.group(1));
      final day = int.tryParse(mdy.group(2) ?? '');
      final year = int.tryParse(mdy.group(3) ?? '');
      if (day == null || month == null || year == null) return null;
      return DateTime(year, month, day);
    }

    return null;
  }

  static int? tryParseInrAmount(String? input) {
    if (input == null) return null;
    final value = input.trim();
    if (value.isEmpty) return null;

    final normalized = value.replaceAll('₹', '').trim();
    final compactMatch = RegExp(
      r'([0-9][0-9,]*(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)?',
      caseSensitive: false,
    ).firstMatch(normalized);

    if (compactMatch != null) {
      final amountText = (compactMatch.group(1) ?? '').replaceAll(',', '');
      final amount = double.tryParse(amountText);
      if (amount == null) return null;
      final suffix = (compactMatch.group(2) ?? '').toLowerCase();
      final multiplier = switch (suffix) {
        'cr' || 'crore' => 10000000,
        'l' || 'lac' || 'lakh' => 100000,
        'k' => 1000,
        _ => 1,
      };
      return (amount * multiplier).round();
    }

    final digits = normalized.replaceAll(RegExp(r'[^0-9]'), '');
    return int.tryParse(digits);
  }

  static String formatInrCompact(int amount) {
    final abs = amount.abs();
    final sign = amount < 0 ? '-' : '';
    if (abs >= 10000000) {
      return '$sign₹${_compactNumber(abs / 10000000)}Cr';
    }
    if (abs >= 100000) {
      return '$sign₹${_compactNumber(abs / 100000)}L';
    }
    if (abs >= 1000) {
      return '$sign₹${_compactNumber(abs / 1000)}k';
    }
    return '$sign₹$abs';
  }

  static DateTime? tripRecordDate(TripRecord trip) {
    return tryParseDate(trip.date);
  }

  static int? tripRecordEarningsInr(TripRecord trip) {
    return tryParseInrAmount(trip.earnings);
  }

  static DateTime? lastCompletedTripDateFromHistory(
    List<TripRecord> history, {
    required DateTime now,
  }) {
    DateTime? latest;
    for (final trip in history) {
      if (!trip.completed) continue;
      final date = tripRecordDate(trip);
      if (date == null) continue;
      if (date.isAfter(now)) continue;
      if (latest == null || date.isAfter(latest)) latest = date;
    }
    return latest;
  }

  static int monthlyEarningsInrFromHistory(
    List<TripRecord> history, {
    required DateTime now,
  }) {
    var total = 0;
    for (final trip in history) {
      if (!trip.completed) continue;
      final date = tripRecordDate(trip);
      if (date == null) continue;
      if (date.year != now.year || date.month != now.month) continue;
      final earnings = tripRecordEarningsInr(trip);
      if (earnings == null) continue;
      total += earnings;
    }
    return total;
  }

  static String timeSinceLastTripLabel(
    List<TripRecord> history, {
    required DateTime now,
    String emptyLabel = '—',
  }) {
    final date = lastCompletedTripDateFromHistory(history, now: now);
    return timeSinceLabel(date, now: now, emptyLabel: emptyLabel);
  }

  static String timeSinceLabel(DateTime? timestamp, {required DateTime now, String emptyLabel = '—'}) {
    if (timestamp == null) return emptyLabel;
    var diff = now.difference(timestamp);
    if (diff.isNegative) diff = Duration.zero;

    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    final weeks = (diff.inDays / 7).floor();
    if (weeks < 5) return '${weeks}w ago';
    final months = (diff.inDays / 30.44).floor();
    if (months < 12) return '${months}mo ago';
    final years = (diff.inDays / 365).floor();
    return '${years}y ago';
  }

  static int? _monthNumber(String? monthText) {
    if (monthText == null) return null;
    final key = monthText.trim().toLowerCase();
    if (key.isEmpty) return null;
    final short = key.length >= 3 ? key.substring(0, 3) : key;
    return switch (short) {
      'jan' => 1,
      'feb' => 2,
      'mar' => 3,
      'apr' => 4,
      'may' => 5,
      'jun' => 6,
      'jul' => 7,
      'aug' => 8,
      'sep' => 9,
      'oct' => 10,
      'nov' => 11,
      'dec' => 12,
      _ => null,
    };
  }

  static String _compactNumber(double value) {
    final rounded = (value * 10).round() / 10;
    final text = rounded.toStringAsFixed(1);
    return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
  }
}

class KpiCalculator {
  static double acceptanceRate(int accepted, int total) => total > 0 ? (accepted / total) * 100 : 0;
  static double earningsPerKm(double totalEarnings, double totalKm) => totalKm > 0 ? totalEarnings / totalKm : 0;
  static double earningsPerHour(double totalEarnings, double totalHours) => totalHours > 0 ? totalEarnings / totalHours : 0;
  static double completionRate(int completed, int total) => total > 0 ? (completed / total) * 100 : 0;
  static double avgRating(double totalStars, int totalRatings) => totalRatings > 0 ? totalStars / totalRatings : 0;
  static double utilizationRate(double drivingHours, double onlineHours) => onlineHours > 0 ? (drivingHours / onlineHours) * 100 : 0;

  static Map<String, double> all({
    required int accepted, required int totalOffers,
    required double earnings, required double km, required double hours,
    required int completed, required double stars, required int ratings,
    required double drivingHours, required double onlineHours,
  }) => {
    'acceptanceRate': acceptanceRate(accepted, totalOffers),
    'earningsPerKm': earningsPerKm(earnings, km),
    'earningsPerHour': earningsPerHour(earnings, hours),
    'completionRate': completionRate(completed, totalOffers),
    'avgRating': avgRating(stars, ratings),
    'utilizationRate': utilizationRate(drivingHours, onlineHours),
  };
}
