import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/app.dart';
import 'setup.dart';

void main() {
  setUpAll(() async {
    await setupTests();
  });

  testWidgets('shows the Truxify splash screen', (tester) async {
    await tester.pumpWidget(const TruxifyApp());

    expect(find.text('Truxify'), findsOneWidget);
    expect(find.text('Freight without middlemen'), findsOneWidget);
  });
}
