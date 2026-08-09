class WorkshopInventory {
  final String workshopId;
  final String workshopName;
  final String address;
  final double distanceMiles;
  final bool hasPartInStock;
  final double estimatedPartCost;
  final int availableBays;
  final DateTime nextAvailableSlot;

  WorkshopInventory({
    required this.workshopId,
    required this.workshopName,
    required this.address,
    required this.distanceMiles,
    required this.hasPartInStock,
    required this.estimatedPartCost,
    required this.availableBays,
    required this.nextAvailableSlot,
  });
}
