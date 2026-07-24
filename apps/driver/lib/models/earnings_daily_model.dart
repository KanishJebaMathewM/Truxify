class EarningsDailyModel {
  final DateTime dayDate;
  final double amount;
  final int tripCount;
  final double hoursDriven;

  EarningsDailyModel({
    required this.dayDate,
    required this.amount,
    required this.tripCount,
    required this.hoursDriven,
  });

  factory EarningsDailyModel.fromMap(Map<String, dynamic> map) {
    return EarningsDailyModel(
      dayDate: DateTime.tryParse(map['day_date']?.toString() ?? '') ?? DateTime.now(),
      amount: ((map['amount'] ?? 0) / 100.0),
      tripCount: map['trip_count'] ?? 0,
      hoursDriven: double.tryParse(map['hours_driven'].toString()) ?? 0.0,
    );
  }
}
