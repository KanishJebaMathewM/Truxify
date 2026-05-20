import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class FreightFairColors {
  // Light mode
  static const background = Color(0xFFFFFFFF);
  static const secondaryBackground = Color(0xFFF5F5F5);
  static const cardBackground = Color(0xFFFAFAFA);
  static const primaryText = Color(0xFF1A1A1A);
  static const secondaryText = Color(0xFF6B6B6B);
  static const accent = Color(0xFF00897B);
  static const accentDark = Color(0xFF00695C);
  static const accentLight = Color(0xFFE0F2F1);
  static const error = Color(0xFFE53935);
  static const warning = Color(0xFFFF6B00);
  static const border = Color(0xFFE0E0E0);

  // Dark mode — reworked for proper contrast
  // Scaffold: #0F0F0F  →  Card: #1C1C1E  →  Elevated card: #242426
  // This gives clear visual layering without being too light
  static const darkBackground = Color(0xFF0F0F0F);
  static const darkSecondaryBackground = Color(0xFF1C1C1E);
  static const darkCardBackground = Color(0xFF242426);
  // Text: near-white primary, warm light-grey secondary (not pure grey)
  static const darkPrimaryText = Color(0xFFF2F2F2);
  static const darkSecondaryText = Color(0xFFB8B8C0); // slightly blue-tinted, more readable
  // Borders: visible but subtle on dark cards
  static const darkBorder = Color(0xFF3A3A3E);
  // Accent tint bg for icons — visible teal tint on dark card
  static const darkAccentLight = Color(0xFF0D3330);

  /// Returns the correct secondary text color for the current theme brightness.
  static Color adaptiveSecondaryText(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? darkSecondaryText
        : secondaryText;
  }
}

class FreightFairTheme {
  static ThemeData light() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: FreightFairColors.accent,
        brightness: Brightness.light,
        primary: FreightFairColors.accent,
        secondary: FreightFairColors.accentDark,
        surface: FreightFairColors.background,
        surfaceContainerHighest: FreightFairColors.secondaryBackground,
        outlineVariant: FreightFairColors.border,
      ),
    );

    return base.copyWith(
      scaffoldBackgroundColor: FreightFairColors.secondaryBackground,
      textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
        bodyColor: FreightFairColors.primaryText,
        displayColor: FreightFairColors.primaryText,
      ),
      cardTheme: CardThemeData(
        color: FreightFairColors.background,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: 0.06),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: const DividerThemeData(color: FreightFairColors.border, thickness: 1),
      appBarTheme: const AppBarTheme(
        backgroundColor: FreightFairColors.background,
        foregroundColor: FreightFairColors.primaryText,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: FreightFairColors.background,
        shape: Border(bottom: BorderSide(color: FreightFairColors.border, width: 1)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: FreightFairColors.background,
        hintStyle: const TextStyle(color: FreightFairColors.secondaryText),
        labelStyle: const TextStyle(color: FreightFairColors.secondaryText),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.accent, width: 1.4),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: FreightFairColors.accent,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: FreightFairColors.accentDark,
          side: const BorderSide(color: FreightFairColors.border),
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: FreightFairColors.accentDark,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: FreightFairColors.background,
        selectedItemColor: FreightFairColors.accent,
        unselectedItemColor: FreightFairColors.secondaryText,
        type: BottomNavigationBarType.fixed,
        elevation: 10,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: FreightFairColors.background,
        indicatorColor: FreightFairColors.accentLight,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 22,
            color: selected ? FreightFairColors.accentDark : FreightFairColors.secondaryText,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 10,
            color: selected ? FreightFairColors.accentDark : FreightFairColors.secondaryText,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          );
        }),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        backgroundColor: FreightFairColors.secondaryBackground,
        selectedColor: FreightFairColors.accentLight,
        labelStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600),
        side: const BorderSide(color: FreightFairColors.border),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: FreightFairColors.accentDark,
        unselectedLabelColor: FreightFairColors.secondaryText,
        indicatorColor: FreightFairColors.accent,
        dividerColor: FreightFairColors.border,
      ),
      iconTheme: const IconThemeData(color: FreightFairColors.primaryText),
    );
  }

  static ThemeData dark() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: FreightFairColors.accent,
        brightness: Brightness.dark,
        primary: FreightFairColors.accent,
        secondary: FreightFairColors.accent,
        surface: FreightFairColors.darkCardBackground,
        surfaceContainerHighest: FreightFairColors.darkSecondaryBackground,
        onSurface: FreightFairColors.darkPrimaryText,
        outlineVariant: FreightFairColors.darkBorder,
      ),
    );

    return base.copyWith(
      scaffoldBackgroundColor: FreightFairColors.darkBackground,
      textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
        bodyColor: FreightFairColors.darkPrimaryText,
        displayColor: FreightFairColors.darkPrimaryText,
      ),
      cardTheme: CardThemeData(
        color: FreightFairColors.darkCardBackground,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: 0.4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: FreightFairColors.darkBorder,
        thickness: 1,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: FreightFairColors.darkSecondaryBackground,
        foregroundColor: FreightFairColors.darkPrimaryText,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        shape: Border(bottom: BorderSide(color: FreightFairColors.darkBorder, width: 1)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: FreightFairColors.darkSecondaryBackground,
        hintStyle: const TextStyle(color: FreightFairColors.darkSecondaryText),
        labelStyle: const TextStyle(color: FreightFairColors.darkSecondaryText),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.darkBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.darkBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: FreightFairColors.accent, width: 1.4),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: FreightFairColors.accent,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: FreightFairColors.accent,
          side: const BorderSide(color: FreightFairColors.darkBorder),
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: FreightFairColors.accent,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: FreightFairColors.darkSecondaryBackground,
        selectedItemColor: FreightFairColors.accent,
        unselectedItemColor: FreightFairColors.darkSecondaryText,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: FreightFairColors.darkSecondaryBackground,
        indicatorColor: FreightFairColors.darkAccentLight,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 22,
            color: selected ? FreightFairColors.accent : FreightFairColors.darkSecondaryText,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 10,
            color: selected ? FreightFairColors.accent : FreightFairColors.darkSecondaryText,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          );
        }),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        backgroundColor: FreightFairColors.darkSecondaryBackground,
        selectedColor: FreightFairColors.darkAccentLight,
        labelStyle: GoogleFonts.dmSans(
          fontWeight: FontWeight.w600,
          color: FreightFairColors.darkPrimaryText,
        ),
        side: const BorderSide(color: FreightFairColors.darkBorder),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: FreightFairColors.accent,
        unselectedLabelColor: FreightFairColors.darkSecondaryText,
        indicatorColor: FreightFairColors.accent,
        dividerColor: FreightFairColors.darkBorder,
        labelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
      ),
      iconTheme: const IconThemeData(color: FreightFairColors.darkPrimaryText),
    );
  }
}

