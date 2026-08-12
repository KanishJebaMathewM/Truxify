import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('DateFormatter Unit Tests', () {
    test('formatDate formats date to dd MMM yyyy', () {
      final date = DateTime(2026, 5, 14);
      expect(DateFormatter.formatDate(date), '14 May 2026');
    });

    test('formatDateTime formats date/time to dd MMM yyyy • hh:mm a', () {
      final date = DateTime(2026, 5, 14, 14, 30);
      expect(DateFormatter.formatDateTime(date), '14 May 2026 \u2022 02:30 PM');
    });

    test('formatTime formats time to hh:mm a', () {
      final date = DateTime(2026, 5, 14, 14, 30);
      expect(DateFormatter.formatTime(date), '02:30 PM');
    });

    test('formatFullDate formats to full weekday, date month year', () {
      final date = DateTime(2026, 5, 14); // May 14, 2026 is Thursday
      expect(DateFormatter.formatFullDate(date), 'Thursday, 14 May 2026');
    });

    test('formatMonthYear formats month and year to MMMM yyyy', () {
      expect(DateFormatter.formatMonthYear(5, 2026), 'May 2026');
    });

    test('formatDateNumeric formats date to yyyy-MM-dd', () {
      final date = DateTime(2026, 5, 14);
      expect(DateFormatter.formatDateNumeric(date), '2026-05-14');
    });

    test('formatRelativeTime returns correct human readable strings', () {
      expect(DateFormatter.formatRelativeTime(null), 'just now');

      final now = DateTime.now();

      final justNow = now.subtract(const Duration(seconds: 10));
      expect(DateFormatter.formatRelativeTime(justNow), 'just now');

      final fiveMinsAgo = now.subtract(const Duration(minutes: 5));
      expect(DateFormatter.formatRelativeTime(fiveMinsAgo), '5 mins ago');

      final oneHourAgo = now.subtract(const Duration(hours: 1));
      expect(DateFormatter.formatRelativeTime(oneHourAgo), '1h ago');

      final fiveHoursAgo = now.subtract(const Duration(hours: 5));
      expect(DateFormatter.formatRelativeTime(fiveHoursAgo), '5h ago');

      final oneDayAgo = now.subtract(const Duration(days: 1));
      expect(DateFormatter.formatRelativeTime(oneDayAgo), '1d ago');

      final fiveDaysAgo = now.subtract(const Duration(days: 5));
      expect(DateFormatter.formatRelativeTime(fiveDaysAgo), '5d ago');

      final twoMonthsAgo = now.subtract(const Duration(days: 60));
      expect(DateFormatter.formatRelativeTime(twoMonthsAgo), '2mo ago');

      final twoYearsAgo = now.subtract(const Duration(days: 730));
      expect(DateFormatter.formatRelativeTime(twoYearsAgo), '2y ago');
    });

    test('parseDate parses string to dd MMM yyyy or returns input on failure', () {
      expect(DateFormatter.parseDate('2026-05-14T00:00:00Z'), '14 May 2026');
      expect(DateFormatter.parseDate('invalid-date'), 'invalid-date');
    });
  });
}
