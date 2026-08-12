class TrailerListing {
  final String listingId;
  final String ownerName;
  final String trailerType; // e.g. 53' Dry Van
  final String originCity;
  final String destinationCity;
  final double rentalPriceUsd; // Could be $0 or negative if owner pays to reposition
  final double distanceMiles;
  final double matchScorePct;

  TrailerListing({
    required this.listingId,
    required this.ownerName,
    required this.trailerType,
    required this.originCity,
    required this.destinationCity,
    required this.rentalPriceUsd,
    required this.distanceMiles,
    required this.matchScorePct,
  });
}
