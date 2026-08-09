class TrailerListing {
  final String trailerId;
  final String ownerCompany;
  final String trailerType; // e.g. 'Dry Van 53ft', 'Reefer 53ft', 'Flatbed'
  final String location;
  final double dailyRate;
  final bool isAvailable;
  final double rating; // 1.0 to 5.0 based on maintenance quality

  TrailerListing({
    required this.trailerId,
    required this.ownerCompany,
    required this.trailerType,
    required this.location,
    required this.dailyRate,
    required this.isAvailable,
    required this.rating,
  });
}
