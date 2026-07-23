import 'package:intl/intl.dart';

/// Centralized date/time formatting utility.
///
/// All date/time display in the application should go through this class
/// to ensure a consistent user experience across all screens.
class DateFormatter {
  DateFormatter._();

  /// Formats a [DateTime] as a compact date string.
  ///
  /// Example: `14 May 2026`
  static String formatDate(DateTime date) {
    return DateFormat('dd MMM yyyy').format(date);
  }

  /// Formats a [DateTime] as a compact date and time string.
  ///
  /// Example: `14 May 2026 • 02:30 PM`
  static String formatDateTime(DateTime date) {
    return DateFormat('dd MMM yyyy \u2022 hh:mm a').format(date);
  }

  /// Formats a [DateTime] as a time-only string.
  ///
  /// Example: `02:30 PM`
  static String formatTime(DateTime date) {
    return DateFormat('hh:mm a').format(date);
  }

  /// Formats a [DateTime] as a full, human-readable date string.
  ///
  /// Example: `Thursday, 14 May 2026`
  static String formatFullDate(DateTime date) {
    return DateFormat('EEEE, d MMMM yyyy').format(date);
  }

  /// Formats a month and year as a readable label.
  ///
  /// Example: `May 2026`
  static String formatMonthYear(int month, int year) {
    final date = DateTime(year, month);
    return DateFormat('MMMM yyyy').format(date);
  }

  /// Formats a [DateTime] as a numeric date string (ISO-like).
  ///
  /// Example: `2026-05-14`
  static String formatDateNumeric(DateTime date) {
    return DateFormat('yyyy-MM-dd').format(date);
  }

  /// Returns a human-friendly relative time description for the given
  /// [dateTime], e.g. "just now", "5 mins ago", "2h ago", "3d ago".
  static String formatRelativeTime(DateTime? dateTime) {
    if (dateTime == null) return 'just now';

    final now = DateTime.now();
    final diff = now.difference(dateTime);

    if (diff.isNegative) {
      // Future dates — treat as "just now"
      return 'just now';
    }

    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes == 1) return '1 min ago';
    if (diff.inMinutes < 60) return '${diff.inMinutes} mins ago';
    if (diff.inHours == 1) return '1h ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return '1d ago';
    if (diff.inDays < 30) return '${diff.inDays}d ago';
    if (diff.inDays < 365) return '${(diff.inDays / 30).floor()}mo ago';
    return '${(diff.inDays / 365).floor()}y ago';
  }

  /// Formats a [DateTime] to a short relative time description suitable
  /// for last-updated labels.
  ///
  /// Example: `just now`, `1 min ago`, `5 mins ago`
  static String formatLastUpdated(DateTime? lastUpdated) {
    return formatRelativeTime(lastUpdated);
  }
}

