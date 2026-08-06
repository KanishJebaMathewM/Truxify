import 'dart:math' as math;

/// Thrown when a request is rate-limited and the retry budget is exhausted
/// or the server keeps returning 429 after the automatic wait-and-retry.
class RateLimitException implements Exception {
  const RateLimitException({required this.retryAfterSeconds, this.message});

  /// How many seconds the caller should wait before trying again.
  final int retryAfterSeconds;
  final String? message;

  @override
  String toString() =>
      'RateLimitException: retry after ${retryAfterSeconds}s. ${message ?? ''}';
}

/// Controls how [ApiClient._execute] retries failed requests.
///
/// Two retry triggers are supported:
///   - **HTTP 429** (Too Many Requests): honours the `Retry-After` response
///     header, waits, then retries once. If the retry also returns 429,
///     throws [RateLimitException] so the UI can show a meaningful message.
///   - **HTTP 5xx** with exponential backoff (opt-in, disabled by default).
///
/// Example — default behaviour (retry on 429, no 5xx retry):
/// ```dart
/// final client = ApiClient(); // uses RetryPolicy.defaultPolicy
/// ```
///
/// Example — disable automatic retry (e.g. for idempotent-sensitive callers):
/// ```dart
/// final client = ApiClient(retryPolicy: RetryPolicy.noRetry);
/// ```
class RetryPolicy {
  const RetryPolicy({
    this.retryOnRateLimit = true,
    this.maxRetryAfterSeconds = 60,
    this.retryOn5xx = false,
    this.maxAttempts = 3,
    this.baseBackoffMs = 500,
  });

  /// Whether to automatically wait and retry on HTTP 429.
  final bool retryOnRateLimit;

  /// Cap the `Retry-After` wait to this many seconds so we never block a
  /// request for e.g. a full hour (some servers return very large values).
  final int maxRetryAfterSeconds;

  /// Whether to retry on HTTP 5xx responses with exponential backoff.
  final bool retryOn5xx;

  /// Maximum total attempts including the initial one.
  final int maxAttempts;

  /// Base delay for exponential backoff in milliseconds.
  final int baseBackoffMs;

  // ── Retry-After parsing ─────────────────────────────────────────────────

  /// Parses the `Retry-After` header value.
  ///
  /// Supports both integer-seconds format (`Retry-After: 60`) and
  /// HTTP-date format (`Retry-After: Wed, 05 Aug 2026 10:00:00 GMT`).
  /// Returns 0 if the header is absent, empty, or cannot be parsed.
  int parseRetryAfter(Map<String, String> headers) {
    final raw = headers['retry-after'] ?? headers['Retry-After'];
    if (raw == null || raw.trim().isEmpty) return 0;

    // Integer seconds
    final seconds = int.tryParse(raw.trim());
    if (seconds != null) return math.max(0, seconds);

    // HTTP-date fallback
    try {
      final date = HttpDate.parse(raw.trim());
      final diff = date.difference(DateTime.now()).inSeconds;
      return diff > 0 ? diff : 0;
    } catch (_) {
      return 0;
    }
  }

  // ── Backoff ─────────────────────────────────────────────────────────────

  /// Exponential backoff duration for the given attempt number (1-indexed),
  /// capped at 30 seconds.
  Duration backoffFor(int attempt) {
    final ms = (baseBackoffMs * math.pow(2, attempt - 1)).toInt();
    return Duration(milliseconds: math.min(ms, 30000));
  }

  // ── Presets ─────────────────────────────────────────────────────────────

  /// Default policy: retry once on 429 (honour Retry-After, cap at 60s).
  static const RetryPolicy defaultPolicy = RetryPolicy();

  /// No automatic retries of any kind.
  static const RetryPolicy noRetry = RetryPolicy(
    retryOnRateLimit: false,
    retryOn5xx: false,
  );
}

// ---------------------------------------------------------------------------
// Minimal HTTP-date parser (avoids adding an extra dependency).
// Handles the RFC 7231 preferred format: "Day, DD Mon YYYY HH:MM:SS GMT"
// ---------------------------------------------------------------------------

class HttpDate {
  static const _months = <String, int>{
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4,
    'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8,
    'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
  };

  /// Parses an RFC 7231 HTTP-date string and returns a UTC [DateTime].
  /// Throws [FormatException] on parse failure.
  static DateTime parse(String value) {
    // e.g. "Wed, 05 Aug 2026 10:00:00 GMT"
    final parts = value.split(RegExp(r'[\s,]+'));
    // parts: [Wed, 05, Aug, 2026, 10:00:00, GMT]  (day-of-week may be absent)
    final filtered = parts.where((p) => p.isNotEmpty).toList();

    // Strip optional day-of-week
    final start = filtered.length == 6 ? 1 : 0;
    final day = int.parse(filtered[start]);
    final month = _months[filtered[start + 1]];
    final year = int.parse(filtered[start + 2]);
    final timeParts = filtered[start + 3].split(':');
    final hour = int.parse(timeParts[0]);
    final minute = int.parse(timeParts[1]);
    final second = int.parse(timeParts[2]);

    if (month == null) throw const FormatException('Unknown month');
    return DateTime.utc(year, month, day, hour, minute, second);
  }
}
