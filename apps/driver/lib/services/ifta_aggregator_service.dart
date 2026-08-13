import 'dart:async';
import '../models/ifta_aggregator_model.dart';

class IftaAggregatorService {
  final _sessionController = StreamController<IftaQuarterlyReport>.broadcast();

  Stream<IftaQuarterlyReport> get reportStream => _sessionController.stream;

  void initializeDashboard() {
    _sessionController.add(IftaQuarterlyReport(
      quarter: 'Q3 2026',
      records: [],
      status: 'Awaiting Aggregation',
      isAggregating: false,
    ));
  }

  void runAggregatorPipeline() async {
    _sessionController.add(IftaQuarterlyReport(
      quarter: 'Q3 2026',
      records: [],
      status: 'Correlating GPS Timestamps...',
      isAggregating: true,
    ));

    await Future.delayed(const Duration(seconds: 1));
    
    _sessionController.add(IftaQuarterlyReport(
      quarter: 'Q3 2026',
      records: [],
      status: 'Joining Fuel Expense Database...',
      isAggregating: true,
    ));

    await Future.delayed(const Duration(seconds: 1));

    _sessionController.add(IftaQuarterlyReport(
      quarter: 'Q3 2026',
      status: 'IFTA Report Generated',
      isAggregating: false,
      records: [
        IftaStateRecord(stateCode: 'TX', milesDriven: 1450.5, gallonsPurchased: 200.0, taxRate: 0.20),
        IftaStateRecord(stateCode: 'OK', milesDriven: 320.0, gallonsPurchased: 50.0, taxRate: 0.14),
        IftaStateRecord(stateCode: 'NM', milesDriven: 850.2, gallonsPurchased: 120.0, taxRate: 0.17),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
