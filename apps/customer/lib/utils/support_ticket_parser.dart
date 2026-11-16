/// Parses support-ticket list payloads into ticket maps.
///
/// The backend may return either the paginated envelope
/// (`{ tickets: [...], pagination: {...} }`) or the legacy direct list
/// (`[...]`); every other shape (missing key, null, wrong types, primitive
/// input) yields an empty list instead of throwing, so a malformed payload
/// can never crash the support screen (issue #16777).
class SupportTicketParser {
  SupportTicketParser._();

  static List<Map<String, dynamic>> parseTickets(dynamic json) {
    if (json is Map<String, dynamic>) {
      final tickets = json['tickets'];
      if (tickets is List) {
        return tickets.whereType<Map<String, dynamic>>().toList();
      }
      return const [];
    }
    if (json is List) {
      return json.whereType<Map<String, dynamic>>().toList();
    }
    return const [];
  }
}
