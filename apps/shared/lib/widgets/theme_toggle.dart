// apps/shared/lib/widgets/theme_toggle.dart
import 'package:flutter/material.dart';
import '../providers/theme_provider.dart';

/// Compact toggle button designed for app headers, AppBars, and drawers.
class ThemeToggle extends StatelessWidget {
  const ThemeToggle({
    super.key,
    required this.provider,
    this.tooltip = 'Toggle theme',
    this.showLabel = false,
  });

  final ThemeProvider provider;
  final String tooltip;
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: provider,
      builder: (context, _) {
        final isDark = provider.isDarkMode(context);
        final mode = provider.themeMode;

        IconData icon;
        String modeLabel;
        if (mode == ThemeMode.system) {
          icon = Icons.brightness_auto;
          modeLabel = 'System';
        } else if (mode == ThemeMode.dark) {
          icon = Icons.dark_mode;
          modeLabel = 'Dark';
        } else {
          icon = Icons.light_mode;
          modeLabel = 'Light';
        }

        if (showLabel) {
          return TextButton.icon(
            onPressed: () => _showThemePicker(context),
            icon: Icon(icon, size: 20),
            label: Text(modeLabel),
          );
        }

        return IconButton(
          tooltip: '$tooltip ($modeLabel)',
          icon: Icon(icon),
          onPressed: () => provider.toggleTheme(context),
        );
      },
    );
  }

  void _showThemePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Theme Preference',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                ThemeSegmentedControl(provider: provider),
                const SizedBox(height: 12),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Segmented control widget for Settings screens ("Theme — Light / Dark / System").
class ThemeSegmentedControl extends StatelessWidget {
  const ThemeSegmentedControl({
    super.key,
    required this.provider,
  });

  final ThemeProvider provider;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: provider,
      builder: (context, _) {
        return SegmentedButton<ThemeMode>(
          segments: const [
            ButtonSegment<ThemeMode>(
              value: ThemeMode.light,
              icon: Icon(Icons.light_mode_outlined, size: 18),
              label: Text('Light'),
            ),
            ButtonSegment<ThemeMode>(
              value: ThemeMode.dark,
              icon: Icon(Icons.dark_mode_outlined, size: 18),
              label: Text('Dark'),
            ),
            ButtonSegment<ThemeMode>(
              value: ThemeMode.system,
              icon: Icon(Icons.brightness_auto_outlined, size: 18),
              label: Text('System'),
            ),
          ],
          selected: <ThemeMode>{provider.themeMode},
          onSelectionChanged: (Set<ThemeMode> newSelection) {
            provider.setThemeMode(newSelection.first);
          },
        );
      },
    );
  }
}

/// A Drawer / Settings ListTile that displays the current theme with quick toggle.
class ThemeToggleTile extends StatelessWidget {
  const ThemeToggleTile({
    super.key,
    required this.provider,
  });

  final ThemeProvider provider;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: provider,
      builder: (context, _) {
        final mode = provider.themeMode;
        String title;
        IconData icon;
        switch (mode) {
          case ThemeMode.light:
            title = 'Light Theme';
            icon = Icons.light_mode;
            break;
          case ThemeMode.dark:
            title = 'Dark Theme';
            icon = Icons.dark_mode;
            break;
          case ThemeMode.system:
            title = 'System Default Theme';
            icon = Icons.brightness_auto;
            break;
        }

        return ListTile(
          leading: Icon(icon),
          title: Text(title),
          subtitle: const Text('Tap to switch between Light, Dark, and System'),
          trailing: ThemeToggle(provider: provider),
          onTap: () => provider.toggleTheme(context),
        );
      },
    );
  }
}
