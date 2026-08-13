class IftaStateRecord {
  final String stateCode; // "TX", "OK", "NM"
  final double milesDriven;
  final double gallonsPurchased;
  final double taxRate;
  
  double get calculatedTax => (milesDriven / 6.5) * taxRate; // Assumes 6.5 MPG

  IftaStateRecord({
    required this.stateCode,
    required this.milesDriven,
    required this.gallonsPurchased,
    required this.taxRate,
  });
}

class IftaQuarterlyReport {
  final String quarter; // "Q3 2026"
  final List<IftaStateRecord> records;
  final String status;
  final bool isAggregating;

  IftaQuarterlyReport({
    required this.quarter,
    required this.records,
    required this.status,
    required this.isAggregating,
  });
  
  double get totalTaxOwed => records.fold(0.0, (sum, record) => sum + record.calculatedTax);
}
