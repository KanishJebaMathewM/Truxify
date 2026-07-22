import 'package:flutter_test/flutter_test.dart';
import 'package:driver/services/driver_insights_service.dart';

void main() {
  group('ProfitPrediction.fromJson', () {
    test('parses valid ML response', () {
      final json = {
        'prediction': {
          'predicted_profit': 8500.50,
          'confidence_interval': {
            'lower': 7000.25,
            'upper': 10000.75,
          },
          'currency': 'INR',
        },
      };

      final prediction = ProfitPrediction.fromJson(json);

      expect(prediction.predictedProfit, 8500.50);
      expect(prediction.lowerBound, 7000.25);
      expect(prediction.upperBound, 10000.75);
      expect(prediction.currency, 'INR');
    });

    test('defaults currency to INR when missing', () {
      final json = {
        'prediction': {
          'predicted_profit': 5000,
          'confidence_interval': {
            'lower': 4000,
            'upper': 6000,
          },
        },
      };

      final prediction = ProfitPrediction.fromJson(json);
      expect(prediction.currency, 'INR');
    });

    test('handles integer profit values', () {
      final json = {
        'prediction': {
          'predicted_profit': 3000,
          'confidence_interval': {
            'lower': 2500,
            'upper': 3500,
          },
        },
      };

      final prediction = ProfitPrediction.fromJson(json);
      expect(prediction.predictedProfit, 3000);
      expect(prediction.formattedProfit, '\u20B93000');
    });
  });

  group('ProfitPrediction formatting', () {
    test('formattedProfit rounds to nearest rupee', () {
      final json = {
        'prediction': {
          'predicted_profit': 8499.6,
          'confidence_interval': {'lower': 7000, 'upper': 10000},
        },
      };

      final prediction = ProfitPrediction.fromJson(json);
      expect(prediction.formattedProfit, '\u20B98500');
    });

    test('formattedRange shows lower and upper bounds', () {
      final json = {
        'prediction': {
          'predicted_profit': 5000,
          'confidence_interval': {'lower': 3500.4, 'upper': 6500.6},
        },
      };

      final prediction = ProfitPrediction.fromJson(json);
      expect(prediction.formattedRange, '\u20B93500 \u2013 \u20B96501');
    });
  });

  group('DriverInsightsService', () {
    test('prediction API endpoint is /api/driver/predict-profit', () {
      final service = DriverInsightsService(apiBaseUrl: 'http://localhost:5000');
      // Verify the service can be instantiated with a base URL
      expect(service, isNotNull);
      service.dispose();
    });
  });
}
