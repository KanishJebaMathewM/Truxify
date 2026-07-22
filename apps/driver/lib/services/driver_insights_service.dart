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
    final prediction = json['prediction'];
    if (prediction is! Map<String, dynamic>) {
      throw FormatException('Missing or invalid "prediction" field');
    }
    final ci = prediction['confidence_interval'];
    if (ci is! Map<String, dynamic>) {
      throw FormatException('Missing or invalid "confidence_interval" field');
    }

    return ProfitPrediction(
      predictedProfit: (prediction['predicted_profit'] as num?)?.toDouble() ?? 0.0,
      lowerBound: (ci['lower'] as num?)?.toDouble() ?? 0.0,
      upperBound: (ci['upper'] as num?)?.toDouble() ?? 0.0,
      currency: (prediction['currency'] as String?) ?? 'INR',
    );
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
        _apiBaseUrl = _normalizeBaseUrl(apiBaseUrl ?? defaultApiBaseUrl);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final ApiClient _apiClient;
  final String _apiBaseUrl;

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

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
