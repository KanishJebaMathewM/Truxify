class IftaStateRecord {
  final String stateCode;
  final double milesDriven;
  final double gallonsPurchased;
  final double taxRate;
  final double taxOwed;

  IftaStateRecord({
    required this.stateCode,
    required this.milesDriven,
    required this.gallonsPurchased,
    required this.taxRate,
    required this.taxOwed,
  });
}

class IftaReport {
  final String quarter;
  final String year;
  final List<IftaStateRecord> stateRecords;
  final double totalMiles;
  final double totalGallons;
  final double netTaxBalance;

  IftaReport({
    required this.quarter,
    required this.year,
    required this.stateRecords,
    required this.totalMiles,
    required this.totalGallons,
    required this.netTaxBalance,
  });
}
