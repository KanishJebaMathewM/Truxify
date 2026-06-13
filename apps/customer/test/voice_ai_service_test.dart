import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/services/voice_ai_service.dart';

void main() {
  group('VoiceAiOrderInput Tests', () {
    test('fromMap with null input returns null', () {
      expect(VoiceAiOrderInput.fromMap(null), isNull);
    });

    test('fromMap with valid map constructs DTO correctly', () {
      final map = <String, dynamic>{
        'status': 'in_transit',
        'eta': 'Today 4:30 PM',
        'drop_address': 'Vadodara',
      };
      final input = VoiceAiOrderInput.fromMap(map);
      expect(input, isNotNull);
      expect(input!.status, equals('in_transit'));
      expect(input.eta, equals('Today 4:30 PM'));
      expect(input.dropAddress, equals('Vadodara'));
    });
  });

  group('VoiceAiService.formatStatus Tests', () {
    test('formats standard database statuses correctly', () {
      expect(VoiceAiService.formatStatus('driver_assigned'), equals('driver assigned'));
      expect(VoiceAiService.formatStatus('in_transit'), equals('in transit'));
      expect(VoiceAiService.formatStatus('payment_released'), equals('payment released'));
      expect(VoiceAiService.formatStatus('completed'), equals('delivered'));
      expect(VoiceAiService.formatStatus('delivered'), equals('delivered'));
      expect(VoiceAiService.formatStatus('cancelled'), equals('cancelled'));
      expect(VoiceAiService.formatStatus('pending'), equals('pending'));
    });

    test('normalizes casing and trims whitespace', () {
      expect(VoiceAiService.formatStatus('  IN_TRANSIT  '), equals('in transit'));
      expect(VoiceAiService.formatStatus('  Driver_Assigned  '), equals('driver assigned'));
    });

    test('defaults to pending on null, empty, or whitespace-only inputs', () {
      expect(VoiceAiService.formatStatus(null), equals('pending'));
      expect(VoiceAiService.formatStatus(''), equals('pending'));
      expect(VoiceAiService.formatStatus('   '), equals('pending'));
    });

    test('replaces underscores for unknown custom statuses', () {
      expect(VoiceAiService.formatStatus('custom_state_here'), equals('custom state here'));
    });
  });

  group('VoiceAiService.buildResponse Tests', () {
    test('buildResponse with null DTO returns loading message', () {
      final response = VoiceAiService.buildResponse(null);
      expect(response, equals('Loading your shipment details…'));
    });

    test('buildResponse with complete DTO maps correctly', () {
      const order = VoiceAiOrderInput(
        status: 'in_transit',
        dropAddress: 'Vadodara',
        eta: 'Today 4:30 PM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach Vadodara by Today 4:30 PM.'),
      );
    });

    test('buildResponse with missing ETA uses fallback message', () {
      const order = VoiceAiOrderInput(
        status: 'pending',
        dropAddress: 'Vadodara',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending. ETA information is not yet available.'),
      );
    });

    test('buildResponse with driver_assigned status formats status correctly', () {
      const order = VoiceAiOrderInput(
        status: 'driver_assigned',
        dropAddress: 'Mumbai',
        eta: 'Today 5:00 PM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently driver assigned and expected to reach Mumbai by Today 5:00 PM.'),
      );
    });

    test('buildResponse fallback for unknown status formatted properly', () {
      const order = VoiceAiOrderInput(
        status: 'custom_status_value',
        dropAddress: 'Jaipur',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently custom status value. ETA information is not yet available.'),
      );
    });

    test('buildResponse handles missing status (defaults to pending)', () {
      const order = VoiceAiOrderInput(
        dropAddress: 'Delhi',
        eta: 'Tomorrow 10:00 AM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending and expected to reach Delhi by Tomorrow 10:00 AM.'),
      );
    });

    test('buildResponse handles blank/whitespace status (defaults to pending)', () {
      const order = VoiceAiOrderInput(
        status: '   ',
        dropAddress: 'Delhi',
        eta: 'Tomorrow 10:00 AM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently pending and expected to reach Delhi by Tomorrow 10:00 AM.'),
      );
    });

    test('buildResponse handles missing drop address (defaults to your destination)', () {
      const order = VoiceAiOrderInput(
        status: 'in_transit',
        eta: 'Today 8:00 PM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach your destination by Today 8:00 PM.'),
      );
    });

    test('buildResponse handles blank/whitespace drop address (defaults to your destination)', () {
      const order = VoiceAiOrderInput(
        status: 'in_transit',
        dropAddress: '   ',
        eta: 'Today 8:00 PM',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit and expected to reach your destination by Today 8:00 PM.'),
      );
    });

    test('buildResponse treats blank/whitespace ETA as missing', () {
      const order = VoiceAiOrderInput(
        status: 'in_transit',
        dropAddress: 'Chennai',
        eta: '   ',
      );
      final response = VoiceAiService.buildResponse(order);
      expect(
        response,
        equals('Your shipment is currently in transit. ETA information is not yet available.'),
      );
    });
  });
}
