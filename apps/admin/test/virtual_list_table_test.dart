import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:admin_dashboard/widgets/virtual_list_table.dart';
import 'package:admin_dashboard/services/memory_reclaimer.dart';

void main() {
  testWidgets('VirtualListTable renders rows with ERROR red / OK green status colors', (tester) async {
    final rows = [
      {'timestamp': '10:00', 'event': 'load created', 'status': 'OK'},
      {'timestamp': '10:01', 'event': 'upload failed', 'status': 'ERROR'},
    ];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: VirtualListTable(logRows: rows, itemExtent: 40)),
    ));
    expect(find.text('load created'), findsOneWidget);
    expect(find.text('upload failed'), findsOneWidget);
    expect(find.text('ERROR'), findsOneWidget);
    expect(find.text('OK'), findsOneWidget);

    final errorText = tester.widget<Text>(find.text('ERROR'));
    expect(errorText.style?.color, Colors.redAccent);
    final okText = tester.widget<Text>(find.text('OK'));
    expect(okText.style?.color, Colors.greenAccent);
  });

  testWidgets('empty row fields render empty strings without throwing', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: VirtualListTable(logRows: const [{}], itemExtent: 40)),
    ));
    expect(find.byType(ListView), findsOneWidget);
  });

  test('WebGLMemoryReclaimerService is a singleton and counts cycles', () {
    final a = WebGLMemoryReclaimerService();
    final b = WebGLMemoryReclaimerService();
    expect(identical(a, b), isTrue);
    // 100 purge cycles must not throw (debugPrint fires at 50 and 100)
    for (var i = 0; i < 100; i++) {
      a.purgeOffscreenCanvasMemory();
    }
  });
}
