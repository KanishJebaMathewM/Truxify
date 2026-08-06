import 'dart:convert';

/// Parses the support tickets response body safely.
///
/// Handles `{ "tickets": [...], "pagination": {...} }` maps, legacy direct `[...]` lists,
/// and returns an empty list if data is missing or malformed.
List<dynamic> parseSupportTicketsResponse(String responseBody) {
  try {
    final decoded = json.decode(responseBody);
    return switch (decoded) {
      Map<String, dynamic> map =>
        map['tickets'] is List ? map['tickets'] as List<dynamic> : <dynamic>[],
      List<dynamic> list => list,
      _ => <dynamic>[],
    };
  } catch (_) {
    return <dynamic>[];
  }
}
