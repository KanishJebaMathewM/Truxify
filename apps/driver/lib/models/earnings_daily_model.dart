/// Model representing a driver's earnings summary for a single day.
class EarningsDailyModel {
  final DateTime dayDate;

  /// Gross earnings in rupees (already divided by 100 from backend paise value).
  final double amount;

  final int tripCount;
  final double hoursDriven;

  /// Estimated fuel + toll deduction (15% of gross).
  /// Adjust the constant below when the backend starts returning real figures.
  final double fuelTollDeduction;

  EarningsDailyModel({
    required this.dayDate,
    required this.amount,
    required this.tripCount,
    required this.hoursDriven,
    double? fuelTollDeduction,
  }) : fuelTollDeduction = fuelTollDeduction ?? amount * 0.15;

  /// Net earnings after subtracting the fuel/toll estimate.
  double get netAmount => amount - fuelTollDeduction;

  factory EarningsDailyModel.fromMap(Map<String, dynamic> map) {
    // Guard against non-numeric amount values (e.g. string from API).
    final rawAmount = map['amount'];
    double gross;
    if (rawAmount is num) {
      gross = (rawAmount / 100.0).toDouble();
    } else if (rawAmount is String) {
      gross = (num.tryParse(rawAmount)?.toDouble() ?? 0.0) / 100.0;
    } else {
      gross = 0.0;
    }
    // If the backend ever starts sending 'fuel_toll_deduction', use it;
    // otherwise fall back to the 15% estimate.
    final rawDeduction = map['fuel_toll_deduction'];
    double deduction;
    if (rawDeduction is num) {
      deduction = (rawDeduction / 100.0).toDouble();
    } else if (rawDeduction is String) {
      deduction = (num.tryParse(rawDeduction)?.toDouble() ?? gross * 0.15) / 100.0;
    } else {
      deduction = gross * 0.15;
    }

    return EarningsDailyModel(
      dayDate:
          DateTime.tryParse(map['day_date']?.toString() ?? '') ?? DateTime.now(),
      amount: gross,
      tripCount: (map['trip_count'] as num?)?.toInt() ?? 0,
      hoursDriven:
          double.tryParse(map['hours_driven'].toString()) ?? 0.0,
      fuelTollDeduction: deduction,
    );
  }
}