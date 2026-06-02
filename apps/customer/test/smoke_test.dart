import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/app.dart';

void main() {
  testWidgets('shows the Truxify splash screen', (tester) async {
    await tester.pumpWidget(const TruxifyApp());

    expect(find.text('Truxify'), findsOneWidget);
    expect(find.text('Freight without middlemen'), findsOneWidget);
  });
}
