import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/earnings_daily_model.dart';

void main() {
  test('fromMap handles amount as String', () {
    final model = EarningsDailyModel.fromMap({
      'day_date': '2026-05-14',
      'amount': '5000',
      'trip_count': 3,
      'hours_driven': '4.5',
    });
    expect(model.amount, 50.0);
  });

  test('fromMap handles amount as num', () {
    final model = EarningsDailyModel.fromMap({
      'day_date': '2026-05-14',
      'amount': 5000,
    });
    expect(model.amount, 50.0);
  });

  test('fromMap defaults to 0 when amount is missing or invalid', () {
    expect(EarningsDailyModel.fromMap({'day_date': '2026-05-14'}).amount, 0.0);
    expect(
        EarningsDailyModel.fromMap({'day_date': '2026-05-14', 'amount': null})
            .amount,
        0.0);
    expect(
        EarningsDailyModel.fromMap(
                {'day_date': '2026-05-14', 'amount': 'not-a-number'})
            .amount,
        0.0);
  });

  test('fromMap handles fuel_toll_deduction as num', () {
    final model = EarningsDailyModel.fromMap({
      'day_date': '2026-05-14',
      'amount': 10000,
      'fuel_toll_deduction': 1500,
    });
    expect(model.fuelTollDeduction, 15.0);
    expect(model.netAmount, 85.0);
  });

  test('fromMap handles fuel_toll_deduction as String', () {
    final model = EarningsDailyModel.fromMap({
      'day_date': '2026-05-14',
      'amount': '10000',
      'fuel_toll_deduction': '1500',
    });
    expect(model.fuelTollDeduction, 15.0);
    expect(model.netAmount, 85.0);
  });

  test('fromMap falls back to 15% estimate when fuel_toll_deduction is null or missing', () {
    final model = EarningsDailyModel.fromMap({
      'day_date': '2026-05-14',
      'amount': 10000,
      'fuel_toll_deduction': null,
    });
    expect(model.amount, 100.0);
    expect(model.fuelTollDeduction, 15.0);
    expect(model.netAmount, 85.0);
  });
}

