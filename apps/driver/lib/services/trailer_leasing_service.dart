import 'dart:async';
import '../models/trailer_listing_model.dart';

class TrailerLeasingService {
  /// Simulates querying the Truxify P2P network for available trailers in a specific region
  Future<List<TrailerListing>> searchAvailableTrailers(String locationZip, String type) async {
    // Simulate API query latency
    await Future.delayed(const Duration(seconds: 2));

    return [
      TrailerListing(
        trailerId: 'TRL-X992-1',
        ownerCompany: 'Midwest Express Logistics',
        trailerType: 'Dry Van 53ft',
        location: 'Chicago, IL (Drop Yard B)',
        dailyRate: 35.00,
        isAvailable: true,
        rating: 4.8,
      ),
      TrailerListing(
        trailerId: 'TRL-R441-9',
        ownerCompany: 'ColdChain Carriers LLC',
        trailerType: 'Reefer 53ft',
        location: 'Gary, IN (Flying J)',
        dailyRate: 65.00,
        isAvailable: true,
        rating: 4.9,
      ),
      TrailerListing(
        trailerId: 'TRL-F002-3',
        ownerCompany: 'Steel Haulers Inc',
        trailerType: 'Flatbed 48ft',
        location: 'Joliet, IL (Warehouse 4)',
        dailyRate: 40.00,
        isAvailable: true,
        rating: 4.2,
      ),
    ];
  }

  Future<bool> bookTrailer(String trailerId, int days) async {
    await Future.delayed(const Duration(seconds: 1));
    return true; // Simulate successful booking and smart contract escrow
  }
}
