
import 'dart:convert';

List<Map<String, dynamic>> parseSupportTicketsResponse(String response) {
  try {
    final decoded = jsonDecode(response);

    // Handle legacy direct list response
    if (decoded is List) {
      return decoded
          .whereType<Map>()
          .map((ticket) => Map<String, dynamic>.from(ticket))
          .toList();
    }

    // Handle standard backend map response
    if (decoded is Map) {
      final tickets = decoded['tickets'];

      if (tickets is List) {
        return tickets
            .whereType<Map>()
            .map((ticket) => Map<String, dynamic>.from(ticket))
            .toList();
      }
    }

    // Return empty list for unexpected responses
    return [];
  } catch (e) {
    // Handle malformed JSON
    return [];
  }
}
