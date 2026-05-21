import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class TruxifyColors {
  // Light mode palette (maroon + greys)
  static const background = Color(0xFFF7F3F3); // primary background
  static const secondaryBackground = Color(0xFFF0E8E8);
  static const cardBackground = Color(0xFFFFFFFF);
  static const inputFill = Color(0xFFFAF5F5);

  // Text
  static const primaryText = Color(0xFF1A1A1A);
  static const secondaryText = Color(0xFF4F4F4F);
  static const tertiaryText = Color(0xFF7A7A7A);
  static const white = Color(0xFFFFFFFF);

  // Accents
  static const accent = Color(0xFF8B1A1A);
  static const accentDark = Color(0xFF6B0F0F);
  static const accentLight = Color(0xFFFDEAEA);
  static const accentVeryLight = Color(0xFFF7F0F0);

  // Support
  static const warning = Color(0xFFD4620A);
  static const warningLight = Color(0xFFFFF3E8);
  static const error = Color(0xFFC62828);
  static const success = Color(0xFF2E7D32);
  static const successLight = Color(0xFFE8F5E9);

  // Borders
  static const border = Color(0xFFEDE4E4);
  static const subtleBorder = Color(0xFFF0E8E8);
  static const strongBorder = Color(0xFFD4BFBF);

  // Extended palette for Trips / Earnings screens
  static const errorRed = Color(0xFFE53935);
  static const errorLight = Color(0xFFFCEAEA);
  static const hintText = Color(0xFF999999);
  static const navInactive = Color(0xFFCCBBBB);

  // Dark mode equivalents (kept simple, mapped to light variants)
  static const darkBackground = Color(0xFF121212);
  static const darkSecondaryBackground = Color(0xFF1E1E1E);
  static const darkCardBackground = Color(0xFF242426);
  static const darkPrimaryText = Color(0xFFF2F2F2);
  static const darkSecondaryText = Color(0xFFB8B8C0);
  static const darkBorder = Color(0xFF3A3A3E);
  static const darkAccentLight = Color(0xFF6B0F0F);

  /// Returns the correct secondary text color for the current theme brightness.
  static Color adaptiveSecondaryText(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? darkSecondaryText
        : secondaryText;
  }

  // Backwards-compatible aliases used across widgets/screens.
  static const primaryBackground = background;
  static const elevatedCard = cardBackground;
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
      scaffoldBackgroundColor: TruxifyColors.background,
      textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
        bodyColor: TruxifyColors.primaryText,
        displayColor: TruxifyColors.primaryText,
      ),
      cardTheme: CardThemeData(
        color: TruxifyColors.cardBackground,
        elevation: 0,
        shadowColor: TruxifyColors.accent.withValues(alpha: 0.06),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: const DividerThemeData(color: TruxifyColors.subtleBorder, thickness: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: TruxifyColors.cardBackground,
        foregroundColor: TruxifyColors.primaryText,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: TruxifyColors.cardBackground,
        titleTextStyle: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.w600, color: TruxifyColors.primaryText),
        iconTheme: const IconThemeData(color: TruxifyColors.primaryText),
        shape: const Border(bottom: BorderSide(color: TruxifyColors.border, width: 1)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TruxifyColors.inputFill,
        hintStyle: const TextStyle(color: TruxifyColors.tertiaryText),
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
          foregroundColor: TruxifyColors.white,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: TruxifyColors.cardBackground,
          foregroundColor: TruxifyColors.secondaryText,
          side: const BorderSide(color: TruxifyColors.border),
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: TruxifyColors.accent,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600),
        ),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: TruxifyColors.cardBackground,
        selectedItemColor: TruxifyColors.accent,
        unselectedItemColor: TruxifyColors.tertiaryText,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        selectedLabelStyle: GoogleFonts.dmSans(fontSize: 10, fontWeight: FontWeight.w600),
        unselectedLabelStyle: GoogleFonts.dmSans(fontSize: 10, fontWeight: FontWeight.w400),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: TruxifyColors.cardBackground,
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
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        backgroundColor: TruxifyColors.cardBackground,
        selectedColor: TruxifyColors.accent,
        labelStyle: GoogleFonts.dmSans(
          fontWeight: FontWeight.w600,
          color: WidgetStateColor.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return TruxifyColors.white;
            }
            return TruxifyColors.primaryText;
          }),
        ),
        side: const BorderSide(color: TruxifyColors.border),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: TruxifyColors.accent,
        unselectedLabelColor: TruxifyColors.tertiaryText,
        indicator: UnderlineTabIndicator(borderSide: BorderSide(color: TruxifyColors.accent, width: 2)),
        indicatorColor: TruxifyColors.accent,
        labelStyle: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.w600),
        unselectedLabelStyle: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.w400),
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
