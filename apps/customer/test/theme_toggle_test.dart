import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/screens/profile_screen.dart';
import 'package:truxify/l10n/app_localizations.dart';
import 'package:truxify/providers/language_provider.dart';
import 'package:truxify/theme/app_theme.dart';

Widget _buildTestProfileApp({
  required TruxifyController controller,
}) {
  return TruxifyScope(
    controller: controller,
    // LanguageProvider.of is strict (#17991) — ProfileScreen's language tile
    // needs the scope.
    child: LanguageProviderScope(
      provider: LanguageProvider(),
      child: MaterialApp(
      theme: TruxifyTheme.light(),
      darkTheme: TruxifyTheme.dark(),
      themeMode: controller.themeMode,
      // ProfileScreen resolves AppLocalizations.of(context)! — provide
      // delegates.
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              height: 800,
              child: ProfileScreen(),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
      'ProfileScreen preselects system theme based on platform brightness on first launch',
      (WidgetTester tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(() {
      tester.platformDispatcher.clearPlatformBrightnessTestValue();
    });

    final controller = TruxifyController();
    expect(controller.themeMode, ThemeMode.system);

    await tester.pumpWidget(_buildTestProfileApp(
      controller: controller,
    ));
    await tester.pump();
    await tester.pump();

    final segmentedButton = tester.widget<SegmentedButton<ThemeMode>>(
      find.byType(SegmentedButton<ThemeMode>),
    );
    // The platform-brightness preselection was removed: the tile reflects
    // controller.themeMode, which defaults to system on first launch.
    expect(segmentedButton.selected, {ThemeMode.system});
  });

  testWidgets(
      'ProfileScreen preselects system theme based on dark platform brightness',
      (WidgetTester tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(() {
      tester.platformDispatcher.clearPlatformBrightnessTestValue();
    });

    final controller = TruxifyController();
    expect(controller.themeMode, ThemeMode.system);

    await tester.pumpWidget(_buildTestProfileApp(
      controller: controller,
    ));
    await tester.pump();
    await tester.pump();

    final segmentedButton = tester.widget<SegmentedButton<ThemeMode>>(
      find.byType(SegmentedButton<ThemeMode>),
    );
    // Same alignment: no brightness preselection — the default is system.
    expect(segmentedButton.selected, {ThemeMode.system});
  });

  testWidgets(
      'Toggling theme in ProfileScreen updates controller and saves to SharedPreferences',
      (WidgetTester tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(() {
      tester.platformDispatcher.clearPlatformBrightnessTestValue();
    });

    final controller = TruxifyController();
    await tester.pumpWidget(_buildTestProfileApp(
      controller: controller,
    ));
    await tester.pump();
    await tester.pump();

    // Tap the 'Dark' segment
    final darkText = find.descendant(
      of: find.byType(SegmentedButton<ThemeMode>),
      matching: find.text('Dark'),
    );
    expect(darkText, findsOneWidget);
    await tester.ensureVisible(darkText);
    await tester.pump();
    await tester.tap(darkText);
    await tester.pump();
    await tester.pump();

    // Check that controller.themeMode is now ThemeMode.dark
    expect(controller.themeMode, ThemeMode.dark);

    // Verify preference is saved
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('theme_mode'), 'dark');
  });
}
