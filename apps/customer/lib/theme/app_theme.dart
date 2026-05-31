import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class TruxifyColors {
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

class TruxifyTheme {
  static ThemeData light() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: TruxifyColors.accent,
        brightness: Brightness.light,
        primary: TruxifyColors.accent,
        secondary: TruxifyColors.accentDark,
        surface: TruxifyColors.background,
        surfaceContainerHighest: TruxifyColors.secondaryBackground,
        outlineVariant: TruxifyColors.border,
      ),
    );

    return base.copyWith(
      scaffoldBackgroundColor: TruxifyColors.secondaryBackground,
      textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
        bodyColor: TruxifyColors.primaryText,
        displayColor: TruxifyColors.primaryText,
      ),
      cardTheme: CardThemeData(
        color: TruxifyColors.background,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: 0.06),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: const DividerThemeData(color: TruxifyColors.border, thickness: 1),
      appBarTheme: const AppBarTheme(
        backgroundColor: TruxifyColors.background,
        foregroundColor: TruxifyColors.primaryText,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: TruxifyColors.background,
        shape: Border(bottom: BorderSide(color: TruxifyColors.border, width: 1)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TruxifyColors.background,
        hintStyle: const TextStyle(color: TruxifyColors.secondaryText),
        labelStyle: const TextStyle(color: TruxifyColors.secondaryText),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.accent, width: 1.4),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: TruxifyColors.accent,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: TruxifyColors.accentDark,
          side: const BorderSide(color: TruxifyColors.border),
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: TruxifyColors.accentDark,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: TruxifyColors.background,
        selectedItemColor: TruxifyColors.accent,
        unselectedItemColor: TruxifyColors.secondaryText,
        type: BottomNavigationBarType.fixed,
        elevation: 10,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: TruxifyColors.background,
        indicatorColor: TruxifyColors.accentLight,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 22,
            color: selected ? TruxifyColors.accentDark : TruxifyColors.secondaryText,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 10,
            color: selected ? TruxifyColors.accentDark : TruxifyColors.secondaryText,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          );
        }),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        backgroundColor: TruxifyColors.secondaryBackground,
        selectedColor: TruxifyColors.accentLight,
        labelStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600),
        side: const BorderSide(color: TruxifyColors.border),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: TruxifyColors.accentDark,
        unselectedLabelColor: TruxifyColors.secondaryText,
        indicatorColor: TruxifyColors.accent,
        dividerColor: TruxifyColors.border,
      ),
      iconTheme: const IconThemeData(color: TruxifyColors.primaryText),
    );
  }

  static ThemeData dark() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: TruxifyColors.accent,
        brightness: Brightness.dark,
        primary: TruxifyColors.accent,
        secondary: TruxifyColors.accent,
        surface: TruxifyColors.darkCardBackground,
        surfaceContainerHighest: TruxifyColors.darkSecondaryBackground,
        onSurface: TruxifyColors.darkPrimaryText,
        outlineVariant: TruxifyColors.darkBorder,
      ),
    );

    return base.copyWith(
      scaffoldBackgroundColor: TruxifyColors.darkBackground,
      textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
        bodyColor: TruxifyColors.darkPrimaryText,
        displayColor: TruxifyColors.darkPrimaryText,
      ),
      cardTheme: CardThemeData(
        color: TruxifyColors.darkCardBackground,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: 0.4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: TruxifyColors.darkBorder,
        thickness: 1,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: TruxifyColors.darkSecondaryBackground,
        foregroundColor: TruxifyColors.darkPrimaryText,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        shape: Border(bottom: BorderSide(color: TruxifyColors.darkBorder, width: 1)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TruxifyColors.darkSecondaryBackground,
        hintStyle: const TextStyle(color: TruxifyColors.darkSecondaryText),
        labelStyle: const TextStyle(color: TruxifyColors.darkSecondaryText),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.darkBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.darkBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: TruxifyColors.accent, width: 1.4),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: TruxifyColors.accent,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: TruxifyColors.accent,
          side: const BorderSide(color: TruxifyColors.darkBorder),
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: TruxifyColors.accent,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: TruxifyColors.darkSecondaryBackground,
        selectedItemColor: TruxifyColors.accent,
        unselectedItemColor: TruxifyColors.darkSecondaryText,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: TruxifyColors.darkSecondaryBackground,
        indicatorColor: TruxifyColors.darkAccentLight,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 22,
            color: selected ? TruxifyColors.accent : TruxifyColors.darkSecondaryText,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 10,
            color: selected ? TruxifyColors.accent : TruxifyColors.darkSecondaryText,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          );
        }),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        backgroundColor: TruxifyColors.darkSecondaryBackground,
        selectedColor: TruxifyColors.darkAccentLight,
        labelStyle: GoogleFonts.dmSans(
          fontWeight: FontWeight.w600,
          color: TruxifyColors.darkPrimaryText,
        ),
        side: const BorderSide(color: TruxifyColors.darkBorder),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: TruxifyColors.accent,
        unselectedLabelColor: TruxifyColors.darkSecondaryText,
        indicatorColor: TruxifyColors.accent,
        dividerColor: TruxifyColors.darkBorder,
        labelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
      ),
      iconTheme: const IconThemeData(color: TruxifyColors.darkPrimaryText),
    );
  }
}

