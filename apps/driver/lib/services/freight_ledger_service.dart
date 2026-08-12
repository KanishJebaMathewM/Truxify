import 'dart:async';
import '../models/freight_ledger_model.dart';

class FreightLedgerService {
  final _sessionController = StreamController<FreightLedgerSession>.broadcast();

  Stream<FreightLedgerSession> get ledgerStream => _sessionController.stream;

  void simulateColdChainTransit() async {
    // 1. Nominal logging
    _sessionController.add(FreightLedgerSession(
      status: 'Securing Cold-Chain to Blockchain...',
      freightType: 'Pfizer mRNA Vaccines',
      targetTempF: -94.0,
      maxAllowedDeviationF: 2.0,
      currentTempF: -94.5,
      isColdChainBroken: false,
      totalBlocksCommitted: 142,
      recentLogs: [
        TempLogEntry(timestamp: DateTime.now().subtract(const Duration(minutes: 10)), temperatureF: -94.2, cryptographicHash: '0xabc123...'),
        TempLogEntry(timestamp: DateTime.now().subtract(const Duration(minutes: 5)), temperatureF: -94.4, cryptographicHash: '0xdef456...'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Door opens at dock, temp rises slightly but within limit
    _sessionController.add(FreightLedgerSession(
      status: 'COMMITTING IOT TELEMETRY...',
      freightType: 'Pfizer mRNA Vaccines',
      targetTempF: -94.0,
      maxAllowedDeviationF: 2.0,
      currentTempF: -93.1, // Warmed up slightly, but still under the 2 degree deviation (-92.0)
      isColdChainBroken: false,
      totalBlocksCommitted: 143,
      recentLogs: [
        TempLogEntry(timestamp: DateTime.now().subtract(const Duration(minutes: 5)), temperatureF: -94.4, cryptographicHash: '0xdef456...'),
        TempLogEntry(timestamp: DateTime.now(), temperatureF: -93.1, cryptographicHash: '0xghi789...'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Delivery complete, verified Unbroken
    _sessionController.add(FreightLedgerSession(
      status: 'TRANSIT COMPLETE: COLD-CHAIN VERIFIED UNBROKEN',
      freightType: 'Pfizer mRNA Vaccines',
      targetTempF: -94.0,
      maxAllowedDeviationF: 2.0,
      currentTempF: -93.1,
      isColdChainBroken: false,
      totalBlocksCommitted: 143,
      recentLogs: [
        TempLogEntry(timestamp: DateTime.now().subtract(const Duration(minutes: 5)), temperatureF: -94.4, cryptographicHash: '0xdef456...'),
        TempLogEntry(timestamp: DateTime.now(), temperatureF: -93.1, cryptographicHash: '0xghi789...'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
