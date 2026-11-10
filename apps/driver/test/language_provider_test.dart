import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/providers/language_provider.dart';

void main() {
  testWidgets('LanguageProvider.of falls back to the shared default when no LanguageProviderScope is present',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    final BuildContext context = tester.element(find.byType(SizedBox));

    // LanguageProviderScope is never instantiated in the app — the shared
    // default instance is the load-bearing fallback (throwing here would
    // crash profile_screen). Assert the real contract.
    final provider = LanguageProvider.of(context);
    expect(provider, isA<LanguageProvider>());
    expect(LanguageProvider.of(context), same(provider));
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
