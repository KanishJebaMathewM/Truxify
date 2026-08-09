import 'dart:async';
import '../models/p2p_trailer_share_model.dart';

class P2pTrailerShareService {
  Future<List<TrailerListing>> searchAvailableTrailers(String origin, String destination) async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      TrailerListing(
        listingId: 'TRL-9981-A',
        ownerName: 'Midwest Express Freight',
        trailerType: "53' Dry Van",
        originCity: 'Chicago, IL',
        destinationCity: 'Detroit, MI',
        rentalPriceUsd: 0.00, // Free rental because owner needs it moved
        distanceMiles: 283.0,
        matchScorePct: 99.0, // Perfect match for route
      ),
      TrailerListing(
        listingId: 'TRL-4421-B',
        ownerName: 'Lakeside Logistics',
        trailerType: "53' Reefer",
        originCity: 'Gary, IN',
        destinationCity: 'Toledo, OH',
        rentalPriceUsd: 150.00, 
        distanceMiles: 210.0,
        matchScorePct: 85.0, // Partial route match
      ),
    ];
  }
}
