import 'dart:async';
import '../models/wim_bypass_model.dart';

class WimBypassService {
  Stream<WimBypassRequest> streamBypassStatus() async* {
    // 1. Approaching
    yield WimBypassRequest(
      stationId: 'DOT-CA-892',
      stationName: 'I-5 Northbound Weigh Station',
      distanceMiles: 2.5,
      truckSafetyScore: 98.5, // High safety score
      estimatedGrossWeightLbs: 76500, // Under 80k limit
      cryptographicSignature: 'Pending Generation...',
      status: 'Approaching',
    );

    await Future.delayed(const Duration(seconds: 3));

    // 2. Transmitting WIM data
    yield WimBypassRequest(
      stationId: 'DOT-CA-892',
      stationName: 'I-5 Northbound Weigh Station',
      distanceMiles: 1.0,
      truckSafetyScore: 98.5,
      estimatedGrossWeightLbs: 76500,
      cryptographicSignature: '0x8f2a...c91b (Signed)',
      status: 'Transmitting',
    );

    await Future.delayed(const Duration(seconds: 4));

    // 3. Cleared / Bypass granted
    yield WimBypassRequest(
      stationId: 'DOT-CA-892',
      stationName: 'I-5 Northbound Weigh Station',
      distanceMiles: 0.2,
      truckSafetyScore: 98.5,
      estimatedGrossWeightLbs: 76500,
      cryptographicSignature: '0x8f2a...c91b (Verified)',
      status: 'Cleared', // Green Light Bypass
    );
  }
}
