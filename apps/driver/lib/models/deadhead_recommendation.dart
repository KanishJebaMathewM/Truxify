class DeadheadRecommendation {
  const DeadheadRecommendation({
    required this.loadId,
    required this.distanceToPickupKm,
    required this.matchScore,
    required this.detourKm,
    required this.estimatedEarnings,
    this.route = '',
    this.goodsType = '',
    this.pickup = '',
    this.drop = '',
    this.weight = '',
    this.deadline = '',
  });

  final String loadId;
  final double distanceToPickupKm;
  final double matchScore;
  final double detourKm;
  final double estimatedEarnings;

  final String route;
  final String goodsType;
  final String pickup;
  final String drop;
  final String weight;
  final String deadline;

  factory DeadheadRecommendation.fromJson(Map<String, dynamic> json) {
    num _n(String key, [num fallback = 0]) => (json[key] as num?) ?? fallback;
    return DeadheadRecommendation(
      loadId: (json['load_id'] ?? '').toString(),
      distanceToPickupKm: _n('distance_to_pickup_km').toDouble(),
      matchScore: _n('match_score').toDouble(),
      detourKm: _n('detour_km').toDouble(),
      estimatedEarnings: _n('estimated_earnings').toDouble(),
      route: (json['route'] ?? '').toString(),
      goodsType: (json['goods_type'] ?? '').toString(),
      pickup: (json['pickup'] ?? json['pickup_address'] ?? '').toString(),
      drop: (json['drop'] ?? json['drop_address'] ?? '').toString(),
      weight: (json['weight'] ?? '').toString(),
      deadline: (json['pickup_deadline'] ?? '').toString(),
    );
  }

  String get matchScoreLabel {
    if (matchScore >= 80) return 'Excellent';
    if (matchScore >= 60) return 'Good';
    if (matchScore >= 40) return 'Fair';
    return 'Low';
  }
}
