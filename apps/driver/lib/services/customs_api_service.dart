import 'dart:async';
import '../models/customs_manifest_model.dart';

class CustomsApiService {
  Future<CustomsManifest> getManifestStatus(String tripId) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate API call

    return CustomsManifest(
      manifestId: 'ACE-202608-8831A',
      portOfEntry: 'Ambassador Bridge (Detroit, MI)',
      borderAgency: 'US CBP (ACE)',
      status: 'Submitted', // Start in submitted state
      scacCode: 'TRUX',
      tripNumber: tripId,
      estimatedArrival: DateTime.now().add(const Duration(hours: 1, minutes: 15)),
    );
  }

  Future<CustomsManifest> pollForPreclearance(CustomsManifest currentManifest) async {
    // Simulates polling the CBP API and getting an approval
    await Future.delayed(const Duration(seconds: 3));
    
    return CustomsManifest(
      manifestId: currentManifest.manifestId,
      portOfEntry: currentManifest.portOfEntry,
      borderAgency: currentManifest.borderAgency,
      status: 'Accepted - Pre-cleared',
      scacCode: currentManifest.scacCode,
      tripNumber: currentManifest.tripNumber,
      estimatedArrival: currentManifest.estimatedArrival,
      issues: [],
    );
  }
}
