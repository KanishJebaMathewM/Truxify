
import 'dart:convert';

import 'package:flutter/foundation.dart';

/// Parses the support tickets response body safely.
///
/// Supports:
/// - API responses containing a "tickets" list.
/// - Legacy responses containing a direct JSON list.
/// - Missing, null, or invalid ticket data.
///
/// Returns an empty list if the response is malformed
/// or does not contain a valid tickets list.
List<dynamic> parseSupportTicketsResponse(String responseBody) {
  try {
    final dynamic decoded = jsonDecode(responseBody);

    // Handle legacy API responses containing a direct list.
    if (decoded is List) {
      return decoded;
    }

    // Handle API responses containing a tickets field.
    if (decoded is Map) {
      final dynamic tickets = decoded['tickets'];

      if (tickets is List) {
        return tickets;
      }
    }

    // Handle unexpected JSON structures.
    return <dynamic>[];
  } on FormatException catch (error) {
    final String truncatedBody = responseBody.length > 500
        ? '${responseBody.substring(0, 500)}...'
        : responseBody;

    debugPrint(
      'SupportTicketParser: Invalid JSON response: $error\n'
      'Response body: $truncatedBody',
    );

    return <dynamic>[];
  } catch (error) {
    debugPrint(
      'SupportTicketParser: Unexpected parsing error: $error',
    );

    return <dynamic>[];
  }
}
