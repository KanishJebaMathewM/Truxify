import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/providers/language_provider.dart';

void main() {
  testWidgets('LanguageProvider.of throws when no LanguageProviderScope is present',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    final BuildContext context = tester.element(find.byType(SizedBox));

    expect(() => LanguageProvider.of(context), throwsA(isA<FlutterError>()));
  });

  testWidgets('LanguageProvider.of returns the real provider inside scope',
      (WidgetTester tester) async {
    final provider = LanguageProvider();

    await tester.pumpWidget(
      MaterialApp(
        home: LanguageProviderScope(
          provider: provider,
          child: const SizedBox(),
        ),
      ),
    );
    final BuildContext context = tester.element(find.byType(SizedBox));

    expect(LanguageProvider.of(context), same(provider));
  });
}
