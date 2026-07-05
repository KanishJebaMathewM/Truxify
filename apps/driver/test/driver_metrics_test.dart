import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/data/mock_data.dart' as mock;
import 'package:truxify_driver/utils/driver_metrics.dart';
import 'setup/test_setup.dart';

void main() {
  setUpAll(() async {
    await setupTestEnvironment();
  });

  test('DriverMetrics.tryParseDate is defensive', () {
    expect(DriverMetrics.tryParseDate(null), isNull);
    expect(DriverMetrics.tryParseDate(''), isNull);
    expect(DriverMetrics.tryParseDate('14 May 2026'), isNotNull);
    expect(DriverMetrics.tryParseDate('2026-05-14'), isNotNull);
    expect(DriverMetrics.tryParseDate('not a date'), isNull);
  });

  test('DriverMetrics.tryParseInrAmount is defensive', () {
    expect(DriverMetrics.tryParseInrAmount(null), isNull);
    expect(DriverMetrics.tryParseInrAmount(''), isNull);
    expect(DriverMetrics.tryParseInrAmount('₹1,24,800'), 124800);
    expect(DriverMetrics.tryParseInrAmount('₹1.2L'), 120000);
    expect(DriverMetrics.tryParseInrAmount('1,50,000'), 150000);
    expect(DriverMetrics.tryParseInrAmount('₹ 1,50,000'), 150000);
    expect(DriverMetrics.tryParseInrAmount('unknown'), isNull);
  });

  test('Mock-derived home metrics are safe', () {
    expect(mock.driverMonthlyEarningsInr, greaterThanOrEqualTo(0));
    expect(mock.driverMonthlyEarningsLabel, isNotEmpty);
    expect(mock.driverTimeSinceLastTripLabel, isNotEmpty);
  });
}
