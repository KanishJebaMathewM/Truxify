class ArPallet {
  final String palletId;
  final String destination;
  final int weightLbs;
  final bool isFragile;
  final String suggestedPosition; // e.g., 'Row 1, Left (Nose)'
  final String colorCode;
  final bool isPlaced;

  ArPallet({
    required this.palletId,
    required this.destination,
    required this.weightLbs,
    required this.isFragile,
    required this.suggestedPosition,
    required this.colorCode,
    required this.isPlaced,
  });
}
