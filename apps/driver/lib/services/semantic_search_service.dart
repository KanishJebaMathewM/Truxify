import 'dart:async';
import '../models/semantic_search_model.dart';

class SemanticSearchService {
  final _sessionController = StreamController<SemanticSearchSession>.broadcast();

  Stream<SemanticSearchSession> get searchStream => _sessionController.stream;

  void executeSearch(String query) async {
    _sessionController.add(SemanticSearchSession(
      status: 'Parsing NLP Intent...',
      results: [],
      originalQuery: query,
    ));

    await Future.delayed(const Duration(seconds: 1));
    
    // Mocking an NLP parser that extracts meaning from the query
    ParsedSearchIntent intent = ParsedSearchIntent(
      originRegion: 'Texas',
      destinationRegion: 'Midwest',
      equipmentType: 'Flatbed',
      minimumRate: 2.00,
    );

    _sessionController.add(SemanticSearchSession(
      status: 'Searching Load Database...',
      parsedIntent: intent,
      results: [],
      originalQuery: query,
    ));

    await Future.delayed(const Duration(seconds: 1));

    _sessionController.add(SemanticSearchSession(
      status: 'Semantic Search Complete',
      parsedIntent: intent,
      originalQuery: query,
      results: [
        SearchResultLoad(loadId: 'LD-101', origin: 'Dallas, TX', destination: 'Chicago, IL', ratePerMile: 2.45, equipment: 'Flatbed'),
        SearchResultLoad(loadId: 'LD-102', origin: 'Houston, TX', destination: 'Detroit, MI', ratePerMile: 2.15, equipment: 'Flatbed'),
        SearchResultLoad(loadId: 'LD-103', origin: 'Austin, TX', destination: 'Columbus, OH', ratePerMile: 2.05, equipment: 'Flatbed'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
