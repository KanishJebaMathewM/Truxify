import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/services/voice_ai_service.dart';

void main() {
  group('VoiceAiService Tests', () {
    test('buildResponse with null order returns loading message', () {
      final response = VoiceAiService.buildResponse(null);
      expect(response, equals('Loading your shipment details…'));
    });

    test('buildResponse with complete order data maps correctly', () {
      final order = <String, dynamic>{
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
      final order = <String, dynamic>{
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
      final order = <String, dynamic>{
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
      final order = <String, dynamic>{
        'status': 'custom_status_value',
        'drop_address': 'Jaipur',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently custom status value. ETA information is not yet available.'),
      );
    });

    test('buildResponse handles missing status (defaults to pending)', () {
      final order = <String, dynamic>{
        'drop_address': 'Delhi',
        'eta': 'Tomorrow 10:00 AM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending and expected to reach Delhi by Tomorrow 10:00 AM.'),
      );
    });

    test('buildResponse handles blank/whitespace status (defaults to pending)', () {
      final order = <String, dynamic>{
        'status': '   ',
        'drop_address': 'Delhi',
        'eta': 'Tomorrow 10:00 AM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending and expected to reach Delhi by Tomorrow 10:00 AM.'),
      );
    });

    test('buildResponse handles missing drop address (defaults to your destination)', () {
      final order = <String, dynamic>{
        'status': 'in_transit',
        'eta': 'Today 8:00 PM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach your destination by Today 8:00 PM.'),
      );
    });

    test('buildResponse handles blank/whitespace drop address (defaults to your destination)', () {
      final order = <String, dynamic>{
        'status': 'in_transit',
        'drop_address': '   ',
        'eta': 'Today 8:00 PM',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach your destination by Today 8:00 PM.'),
      );
    });

    test('buildResponse treats blank/whitespace ETA as missing', () {
      final order = <String, dynamic>{
        'status': 'in_transit',
        'drop_address': 'Chennai',
        'eta': '   ',
      };
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit. ETA information is not yet available.'),
      );
    });
  });
}
