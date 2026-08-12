import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:flutter/material.dart';
import 'package:truxify_driver/providers/text_scale_provider.dart';
import 'package:truxify_driver/providers/language_provider.dart';
import 'package:truxify_driver/app.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUpAll(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('main.dart should only call runApp once', () {
    final file = File('lib/main.dart');
    final content = file.readAsStringSync();
    
    int count = 'runApp('.allMatches(content).length;
    expect(count, 1, reason: 'runApp should only be called once to prevent discarding the widget tree.');
  });

  testWidgets('Providers are correctly injected above TruxifyApp', (WidgetTester tester) async {
    final languageProvider = LanguageProvider();
    
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => TextScaleProvider()),
          Provider<LanguageProvider>.value(value: languageProvider),
        ],
        child: const TruxifyApp(),
      ),
    );

    await tester.pump();

    final BuildContext context = tester.element(find.byType(TruxifyApp));
    
    expect(Provider.of<TextScaleProvider>(context, listen: false), isNotNull);
    expect(Provider.of<LanguageProvider>(context, listen: false), isNotNull);
  });
}
