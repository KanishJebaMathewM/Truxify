import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../services/crash_reporting_service.dart';

/// A friendly fallback widget displayed when a Flutter widget fails to build.
///
/// In release and profile modes, this replaces Flutter's default red error screen
/// with a user-friendly UI while still reporting the exception to crash reporting.
///
/// In debug mode, the default Flutter error screen is preserved for easier debugging.
class TruxifyErrorWidget extends StatelessWidget {
  const TruxifyErrorWidget({
    super.key,
    required this.errorDetails,
  });

  final FlutterErrorDetails errorDetails;

  /// Returns the appropriate [ErrorWidget.builder] for the current build mode.
  ///
  /// In debug mode, delegates to Flutter's default error presentation.
  /// In release/profile mode, renders [TruxifyErrorWidget].
  static ErrorWidgetBuilder get builder {
    return (FlutterErrorDetails details) {
      // Always report the error to crash reporting.
      CrashReportingService.captureFlutterError(details);

      // Preserve the default behavior in debug mode.
      if (kDebugMode) {
        return ErrorWidget.withDetails(
          message: details.summary?.toString() ?? details.exception.toString(),
          error: details.exception,
        );
      }

      return TruxifyErrorWidget(errorDetails: details);
    };
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: isDark ? const Color(0xFF1C1C1E) : Colors.white,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.error_outline_rounded,
                  size: 64,
                  color: isDark ? const Color(0xFFB8B8C0) : const Color(0xFF6B6B6B),
                ),
                const SizedBox(height: 24),
                Text(
                  'Something went wrong',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: isDark ? const Color(0xFFF2F2F2) : const Color(0xFF1A1A1A),
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'An unexpected error occurred. Our team has been notified '
                  'and is working on a fix.',
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.5,
                    color: isDark ? const Color(0xFFB8B8C0) : const Color(0xFF6B6B6B),
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                _RetryButton(isDark: isDark),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RetryButton extends StatelessWidget {
  const _RetryButton({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () {
        // Remove the failed route and go back, or restart if at root.
        final navigator = Navigator.of(context);
        if (navigator.canPop()) {
          navigator.pop();
        } else {
          // Force rebuild from root by restarting the app is not possible here.
          // Pop until we reach a recoverable state.
          navigator.popUntil((route) => route.isFirst);
        }
      },
      icon: const Icon(Icons.refresh_rounded, size: 18),
      label: const Text('Go Back'),
      style: OutlinedButton.styleFrom(
        foregroundColor: isDark ? const Color(0xFFF2F2F2) : const Color(0xFF1A1A1A),
        side: BorderSide(
          color: isDark ? const Color(0xFF3A3A3E) : const Color(0xFFE0E0E0),
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      ),
    );
  }
}
