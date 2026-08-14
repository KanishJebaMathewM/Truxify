class ParsedSearchIntent {
  final String originRegion;
  final String destinationRegion;
  final String equipmentType;
  final double minimumRate;

  ParsedSearchIntent({
    required this.originRegion,
    required this.destinationRegion,
    required this.equipmentType,
    required this.minimumRate,
  });
}

class SearchResultLoad {
  final String loadId;
  final String origin;
  final String destination;
  final double ratePerMile;
  final String equipment;

  SearchResultLoad({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.ratePerMile,
    required this.equipment,
  });
}

class SemanticSearchSession {
  final String status;
  final ParsedSearchIntent? parsedIntent;
  final List<SearchResultLoad> results;
  final String originalQuery;

  SemanticSearchSession({
    required this.status,
    this.parsedIntent,
    required this.results,
    required this.originalQuery,
  });
}
