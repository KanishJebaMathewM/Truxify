import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify_driver/providers/text_scale_provider.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/l10n/app_localizations.dart';
import 'package:truxify_driver/screens/profile_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

import 'setup/test_setup.dart';

Widget _buildTestProfileApp({
  required TruxifyController controller,
}) {
  return TruxifyScope(
    controller: controller,
    child: ChangeNotifierProvider(
      create: (_) => TextScaleProvider(),
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
  setUpAll(() async {
    await setupTestEnvironment();
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('ProfileScreen selects the controller default (system) on first launch, ignoring platform brightness', (WidgetTester tester) async {
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

  testWidgets('ProfileScreen selects the controller default (system) on first launch with dark platform brightness', (WidgetTester tester) async {
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

  testWidgets('Toggling theme in ProfileScreen updates controller and saves to SharedPreferences', (WidgetTester tester) async {
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
    await tester.tap(darkText);
    await tester.pump();
    await tester.pump();

    // Check that controller.themeMode is now ThemeMode.dark
    expect(controller.themeMode, ThemeMode.dark);

    // Verify preference is saved
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('driver_theme_mode'), 'dark');
  });
}
