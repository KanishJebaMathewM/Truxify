import 'package:flutter_test/flutter_test.dart';
import '../lib/utils/support_ticket_parser.dart';

void main() {
  group('Support Tickets Parser Utility Tests (parseSupportTicketsResponse)', () {
    test('extracts tickets array from standard backend map response with pagination', () {
      const jsonResponse = '''
      {
        "tickets": [
          {"id": "t1", "subject": "Broken truck mirror", "status": "open"},
          {"id": "t2", "subject": "Payment delay", "status": "resolved"}
        ],
        "pagination": {
          "total": 2,
          "page": 1,
          "limit": 10
        }
      }
      ''';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets.length, equals(2));
      expect(tickets[0]['id'], equals('t1'));
      expect(tickets[1]['status'], equals('resolved'));
    });

    test('handles legacy direct list JSON response gracefully', () {
      const jsonResponse = '''
      [
        {"id": "t1", "subject": "Legacy ticket format"}
      ]
      ''';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets.length, equals(1));
      expect(tickets[0]['id'], equals('t1'));
    });

    test('defaults to empty list when tickets key is missing or null', () {
      const jsonResponse = '{"pagination": {"total": 0}}';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets, isEmpty);
    });

    test('defaults to empty list when tickets value is not a list', () {
      const jsonResponse = '{"tickets": "invalid_string_type"}';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets, isEmpty);
    });

    test('defaults to empty list when root response is an unexpected primitive', () {
      const jsonResponse = '12345';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets, isEmpty);
    });

    test('defaults to empty list when json is malformed syntax', () {
      const jsonResponse = '{"invalid_json": ';

      final tickets = parseSupportTicketsResponse(jsonResponse);
      expect(tickets, isEmpty);
    });
  });
}
