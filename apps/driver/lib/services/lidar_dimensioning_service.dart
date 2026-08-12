import 'dart:async';
import '../models/lidar_dimensioning_model.dart';

class LidarDimensioningService {
  final _scanController = StreamController<LidarScanSession>.broadcast();

  Stream<LidarScanSession> get scanStream => _scanController.stream;

  void simulateLidarScan() async {
    final shipperReported = PalletDimensions(
      lengthInches: 48.0,
      widthInches: 40.0,
      heightInches: 50.0, // Shipper claims it's 50 inches tall
      totalCubicFeet: 55.5,
      estimatedFreightClass: 150,
    );

    // 1. Initializing
    _scanController.add(LidarScanSession(
      scanId: 'SCN-8842-A',
      status: 'Initializing iPad LiDAR...',
      scanProgressPct: 0.0,
      shipperReported: shipperReported,
      actualScanned: null,
      revenueRecoveredDollars: 0.0,
    ));

    await Future.delayed(const Duration(seconds: 2));

    // 2. Scanning 1
    _scanController.add(LidarScanSession(
      scanId: 'SCN-8842-A',
      status: 'Scanning Pallet Surface (Walk Around)...',
      scanProgressPct: 35.0,
      shipperReported: shipperReported,
      actualScanned: null,
      revenueRecoveredDollars: 0.0,
    ));
    
    await Future.delayed(const Duration(seconds: 2));
    
    // 3. Scanning 2
    _scanController.add(LidarScanSession(
      scanId: 'SCN-8842-A',
      status: 'Building 3D Point Cloud...',
      scanProgressPct: 75.0,
      shipperReported: shipperReported,
      actualScanned: null,
      revenueRecoveredDollars: 0.0,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 4. Complete - Found discrepancy (taller than reported)
    _scanController.add(LidarScanSession(
      scanId: 'SCN-8842-A',
      status: 'Scan Complete - Discrepancy Detected',
      scanProgressPct: 100.0,
      shipperReported: shipperReported,
      actualScanned: PalletDimensions(
        lengthInches: 48.2,
        widthInches: 40.5,
        heightInches: 72.0, // Actually 72 inches tall!
        totalCubicFeet: 81.3,
        estimatedFreightClass: 250, // Higher class due to volume
      ),
      revenueRecoveredDollars: 145.50, // LTL Carrier makes this much more
    ));
  }

  void dispose() {
    _scanController.close();
  }
}
