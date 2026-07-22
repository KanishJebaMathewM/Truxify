import 'api_client.dart';

class ProfitPrediction {
  const ProfitPrediction({
    required this.predictedProfit,
    required this.lowerBound,
    required this.upperBound,
    required this.currency,
  });

  final double predictedProfit;
  final double lowerBound;
  final double upperBound;
  final String currency;

  factory ProfitPrediction.fromJson(Map<String, dynamic> json) {
    final prediction = _requiredMap(json['prediction'], 'prediction');
    final ci = _requiredMap(
      prediction['confidence_interval'],
      'confidence_interval',
    );

    return ProfitPrediction(
      predictedProfit: _requiredDouble(
        prediction['predicted_profit'],
        'predicted_profit',
      ),
      lowerBound: _requiredDouble(ci['lower'], 'confidence_interval.lower'),
      upperBound: _requiredDouble(ci['upper'], 'confidence_interval.upper'),
      currency: (prediction['currency'] as String?) ?? 'INR',
    );
  }

  static Map<String, dynamic> _requiredMap(dynamic value, String field) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    throw StateError('Missing or invalid profit prediction field: $field');
  }

  static double _requiredDouble(dynamic value, String field) {
    if (value is num) return value.toDouble();
    if (value is String) {
      final parsed = double.tryParse(value);
      if (parsed != null) return parsed;
    }
    throw StateError('Missing or invalid profit prediction field: $field');
  }

  String get formattedProfit {
    final rupees = predictedProfit.round();
    return '\u20B9$rupees';
  }

  String get formattedRange {
    return '\u20B9${lowerBound.round()} \u2013 \u20B9${upperBound.round()}';
  }
}

class DriverInsightsService {
  DriverInsightsService({
    ApiClient? apiClient,
    String? apiBaseUrl,
  })  : _apiClient = apiClient ?? ApiClient(baseUrl: apiBaseUrl),


  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
  );

  final ApiClient _apiClient;

  void dispose() {
    _apiClient.dispose();
  }

  Future<ProfitPrediction> predictProfit({
    required double routeDistanceKm,
    required double fuelPricePerLitre,
    required double tollEstimateInr,
    required double truckMileageKmL,
    required double cargoWeightKg,
    required double tripDurationHours,
  }) async {
    const path = '/api/driver/predict-profit';
    try {
      final decoded = await _apiClient.post(
        path,
        body: <String, dynamic>{
          'route_distance_km': routeDistanceKm,
          'fuel_price_per_litre': fuelPricePerLitre,
          'toll_estimate_inr': tollEstimateInr,
          'truck_mileage_kml': truckMileageKmL,
          'cargo_weight_kg': cargoWeightKg,
          'trip_duration_hours': tripDurationHours,
        },
      );

      if (decoded is! Map<String, dynamic>) {
        throw StateError('Unexpected response type for profit prediction');
      }

      return ProfitPrediction.fromJson(decoded);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }
}
