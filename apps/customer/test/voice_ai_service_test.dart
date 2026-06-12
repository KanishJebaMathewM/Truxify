import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/services/voice_ai_service.dart';

void main() {
  group('VoiceAiService Tests', () {
    test('buildResponse with null order returns loading message', () {
      final response = VoiceAiService.buildResponse(null);
      expect(response, equals('Loading your shipment details…'));
    });

    test('buildResponse with complete order data maps correctly', () {
      final order = {
        'status': 'in_transit',
        'drop_address': 'Vadodara',
        'eta': 'Today 4:30 PM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach Vadodara by Today 4:30 PM.'),
      );
    });

    test('buildResponse with missing ETA uses fallback message', () {
      final order = {
        'status': 'pending',
        'drop_address': 'Vadodara',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending. ETA information is not yet available.'),
      );
    });

    test('buildResponse with driver_assigned status formats status correctly', () {
      final order = {
        'status': 'driver_assigned',
        'drop_address': 'Mumbai',
        'eta': 'Today 5:00 PM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently driver assigned and expected to reach Mumbai by Today 5:00 PM.'),
      );
    });

    test('buildResponse fallback for unknown status formatted properly', () {
      final order = {
        'status': 'custom_status_value',
        'drop_address': 'Jaipur',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently custom status value. ETA information is not yet available.'),
      );
    });
  });
}
