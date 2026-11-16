import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/utils/support_ticket_parser.dart';

void main() {
  group('SupportTicketParser Unit Tests (#16777)', () {
    test('Valid backend response with pagination returns ticket list', () {
      final json = {
        'tickets': [
          {'id': 'TICK-001', 'subject': 'Login issue'},
          {'id': 'TICK-002', 'subject': 'Payment delay'}
        ],
        'pagination': {'page': 1, 'totalPages': 1}
      };

      final result = SupportTicketParser.parseTickets(json);
      expect(result.length, 2);
      expect(result[0]['id'], 'TICK-001');
    });

    test('Legacy direct-list response returns ticket list', () {
      final json = [
        {'id': 'TICK-003', 'subject': 'Route optimization error'}
      ];

      final result = SupportTicketParser.parseTickets(json);
      expect(result.length, 1);
      expect(result[0]['id'], 'TICK-003');
    });

    test('Missing tickets key returns empty list safely', () {
      final json = {'status': 'success', 'data': 'none'};
      final result = SupportTicketParser.parseTickets(json);
      expect(result, isEmpty);
    });

    test('Null tickets value returns empty list safely', () {
      final json = {'tickets': null};
      final result = SupportTicketParser.parseTickets(json);
      expect(result, isEmpty);
    });

    test('Invalid tickets type (string instead of list) returns empty list safely', () {
      final json = {'tickets': 'invalid-ticket-string'};
      final result = SupportTicketParser.parseTickets(json);
      expect(result, isEmpty);
    });

    test('Unexpected primitive JSON (numbers/strings) returns empty list safely', () {
      expect(SupportTicketParser.parseTickets(12345), isEmpty);
      expect(SupportTicketParser.parseTickets('malformed-json-string'), isEmpty);
    });

    test('Null or malformed input returns empty list without throwing exceptions', () {
      expect(() => SupportTicketParser.parseTickets(null), returnsNormally);
      expect(SupportTicketParser.parseTickets(null), isEmpty);
    });
  });
}
