import 'dart:async';
import '../models/carbon_emissions_model.dart';

class CarbonEmissionsService {
  final _sessionController = StreamController<CarbonEmissionsSession>.broadcast();
  
  Stream<CarbonEmissionsSession> get emissionsStream => _sessionController.stream;

  List<FuelConsumption> _rawFuelData = [];

  void initializeDashboard() {
    _rawFuelData = [
      FuelConsumption(quarter: 'Q1 2026', dieselGallonsPurchased: 45200.0, defGallonsPurchased: 1200.0),
      FuelConsumption(quarter: 'Q2 2026', dieselGallonsPurchased: 51000.0, defGallonsPurchased: 1400.0),
      FuelConsumption(quarter: 'Q3 2026', dieselGallonsPurchased: 48500.0, defGallonsPurchased: 1350.0),
    ];
    _emitState('Awaiting Corporate Analytics Request', null, false);
  }

  void compileEsgReport() async {
    _emitState('Ingesting Fleet Expense Database...', null, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Calculating CO2 Molecular Mass Conversion...', null, true);

    await Future.delayed(const Duration(seconds: 1));

    // Simulation metrics (1 gallon diesel ~ 10.18 kg CO2 = 0.01018 metric tons)
    double totalDiesel = _rawFuelData.fold(0, (sum, f) => sum + f.dieselGallonsPurchased);
    double totalDef = _rawFuelData.fold(0, (sum, f) => sum + f.defGallonsPurchased);

    double dieselCO2 = totalDiesel * 0.01018;
    double defCO2 = totalDef * 0.0026; // Mock DEF conversion

    CarbonEmissionReport report = CarbonEmissionReport(
      reportingPeriod: 'Year-to-Date (Q1 - Q3)',
      totalDieselCO2MetricTons: dieselCO2,
      totalDefCO2MetricTons: defCO2,
      grossFleetEmissions: dieselCO2 + defCO2,
      efficiencyRating: 1.84, // kg CO2 per mile
    );

    _emitState('ESG Corporate Compliance Report Generated', report, false);
  }

  void _emitState(String status, CarbonEmissionReport? report, bool isCompiling) {
    _sessionController.add(CarbonEmissionsSession(
      status: status,
      rawFuelData: List.from(_rawFuelData),
      esgReport: report,
      isCompiling: isCompiling,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
