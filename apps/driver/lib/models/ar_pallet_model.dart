class ArPallet {
  final String palletId;
  final double weightLbs;
  final String dimensions;
  final double optimalX; // X coordinate in 3D AR space
  final double optimalY; // Y coordinate (height)
  final double optimalZ; // Z coordinate (depth into trailer)
  final bool isPlaced;

  ArPallet({
    required this.palletId,
    required this.weightLbs,
    required this.dimensions,
    required this.optimalX,
    required this.optimalY,
    required this.optimalZ,
    this.isPlaced = false,
  });
}
