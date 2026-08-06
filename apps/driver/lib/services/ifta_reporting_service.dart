import 'dart:async';
import '../models/ifta_report_model.dart';

class IftaReportingService {
  Future<IftaReport> generateQuarterlyReport() async {
    await Future.delayed(const Duration(seconds: 2));

    return IftaReport(
      quarter: 'Q3',
      year: '2026',
      totalMiles: 14250.5,
      totalGallons: 2035.8,
      netTaxBalance: 124.50, // Positive means owed
      stateRecords: [
        IftaStateRecord(stateCode: 'IL', milesDriven: 4200.0, gallonsPurchased: 800.0, taxRate: 0.454, taxOwed: -15.20),
        IftaStateRecord(stateCode: 'IN', milesDriven: 3100.5, gallonsPurchased: 200.0, taxRate: 0.51, taxOwed: 56.40),
        IftaStateRecord(stateCode: 'OH', milesDriven: 6950.0, gallonsPurchased: 1035.8, taxRate: 0.47, taxOwed: 83.30),
      ],
    );
  }
}
