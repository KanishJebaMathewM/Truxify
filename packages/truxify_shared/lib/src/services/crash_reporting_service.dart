import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';

import '../config/env.dart';

/// Centralized crash reporting and global error handling service.
///
/// Provides a single integration point for:
///   - Sentry SDK initialization
///   - FlutterError.onError
///   - PlatformDispatcher.instance.onError
///   - runZonedGuarded
///   - Custom ErrorWidget.builder
///
/// Usage:
/// ```dart
/// await CrashReportingService.init(appName: 'Customer');
/// // … later …
/// CrashReportingService.captureException(error, stackTrace: stackTrace);
/// ```
class CrashReportingService {
  CrashReportingService._();

  static bool _initialized = false;
  static String _appName = 'Truxify';
  static Map<String, String> _defaultTags = {};

  // ── Initialization ───────────────────────────────────────────────────

  /// Initializes Sentry and wires up all global error handlers.
  ///
  /// Must be called once in [main] before [runApp], after
  /// [WidgetsFlutterBinding.ensureInitialized].
  ///
  /// [appName] is attached to every event as metadata (e.g. 'Customer', 'Driver').
  static Future<void> init({required String appName}) async {
    if (_initialized) return;
    _appName = appName;

    // Collect device/app metadata once at startup.
    _defaultTags = await _collectMetadata();

    if (!Env.isCrashReportingEnabled) {
      if (kDebugMode) {
        developer.log(
          '[CrashReporting] Sentry DSN not configured — crash reporting disabled.',
          name: 'CrashReporting',
        );
      }
      _wireErrorHandlers();
      return;
    }

    await SentryFlutter.init(
      (options) {
        options.dsn = Env.sentryDsn;
        options.environment = Env.environment;
        options.tracesSampleRate = Env.isProd ? 0.2 : 1.0;
        options.debug = kDebugMode;
        options.beforeSend = (event) {
          event.tags?.addAll(_defaultTags);
          return event;
        };
      },
    );

    _initialized = true;

    _wireErrorHandlers();

    if (kDebugMode) {
      developer.log(
        '[CrashReporting] Initialized for app=$_appName env=${Env.environment}',
        name: 'CrashReporting',
      );
    }
  }

  // ── Error handler wiring ─────────────────────────────────────────────

  static void _wireErrorHandlers() {
    // 1. Flutter framework errors (widget build, layout, paint, etc.)
    FlutterError.onError = (details) {
      captureFlutterError(details);

      // Preserve the default behavior in debug mode (prints to console).
      if (kDebugMode) {
        FlutterError.presentError(details);
      }
    };

    // 2. Errors caught by the Dart platform (e.g. native plugin errors).
    PlatformDispatcher.instance.onError = (error, stackTrace) {
      captureException(
        error,
        stackTrace: stackTrace,
        mechanism: 'PlatformDispatcher',
      );
      return true; // Handled.
    };
  }

  // ── Capture methods ──────────────────────────────────────────────────

  /// Reports an arbitrary exception to Sentry.
  static Future<void> captureException(
    Object error, {
    StackTrace? stackTrace,
    String? mechanism,
    Map<String, dynamic>? extra,
  }) async {
    // Always log in debug for local troubleshooting.
    if (kDebugMode) {
      developer.log(
        '[CrashReporting] captureException: $error',
        name: 'CrashReporting',
        error: error,
        stackTrace: stackTrace,
      );
    }

    if (!_initialized || !Env.isCrashReportingEnabled) return;

    await Sentry.captureException(
      error,
      stackTrace: stackTrace,
      hint: Hint.withMap({
        if (mechanism != null) 'mechanism': mechanism,
        if (extra != null) ...extra,
      }),
    );
  }

  /// Reports a non-exception message (info / warning / error level).
  static Future<void> captureMessage(
    String message, {
    SentryLevel level = SentryLevel.info,
    Map<String, dynamic>? extra,
  }) async {
    if (kDebugMode) {
      developer.log(
        '[CrashReporting] captureMessage: $message',
        name: 'CrashReporting',
      );
    }

    if (!_initialized || !Env.isCrashReportingEnabled) return;

    await Sentry.captureMessage(
      message,
      level: level,
      hint: Hint.withMap(extra ?? {}),
    );
  }

  /// Reports a [FlutterErrorDetails] event.
  static Future<void> captureFlutterError(
    FlutterErrorDetails details,
  ) async {
    if (kDebugMode) {
      developer.log(
        '[CrashReporting] FlutterError: ${details.exception}',
        name: 'CrashReporting',
        error: details.exception,
        stackTrace: details.stack,
      );
    }

    if (!_initialized || !Env.isCrashReportingEnabled) return;

    await Sentry.captureException(
      details.exception,
      stackTrace: details.stack,
      hint: Hint.withMap({
        'mechanism': 'FlutterError.onError',
        'library': details.library ?? '',
        'context': details.context?.toString() ?? '',
        if (details.summary != null) 'summary': details.summary.toString(),
      }),
    );
  }

  // ── Tags & Context ───────────────────────────────────────────────────

  /// Sets a tag that will be attached to all subsequent events.
  static void setTag(String key, String value) {
    Sentry.configureScope((scope) => scope.setTag(key, value));
  }

  /// Sets the user context for crash reports.
  static void setUserContext({
    String? id,
    String? email,
    String? role,
  }) {
    Sentry.configureScope((scope) {
      scope.setUser(SentryUser(
        id: id,
        email: email,
        extras: {
          if (role != null) 'role': role,
        },
      ));
    });
  }

  /// Clears the user context (e.g. on logout).
  static void clearUser() {
    Sentry.configureScope((scope) => scope.setUser(null));
  }

  /// Flushes any buffered events. Call before app termination.
  static Future<void> flush() async {
    if (_initialized && Env.isCrashReportingEnabled) {
      await Sentry.flush(timeout: const Duration(seconds: 3));
    }
  }

  /// Closes the Sentry SDK. Call when shutting down.
  static Future<void> close() async {
    if (_initialized && Env.isCrashReportingEnabled) {
      await Sentry.close();
      _initialized = false;
    }
  }

  // ── Metadata collection ──────────────────────────────────────────────

  static Future<Map<String, String>> _collectMetadata() async {
    final tags = <String, String>{
      'app.name': _appName,
      'app.environment': Env.environment,
      'build.mode': kReleaseMode
          ? 'release'
          : kProfileMode
              ? 'profile'
              : 'debug',
    };

    try {
      final packageInfo = await PackageInfo.fromPlatform();
      tags['app.version'] = packageInfo.version;
      tags['app.buildNumber'] = packageInfo.buildNumber;
      tags['app.packageName'] = packageInfo.packageName;
    } catch (_) {
      // PackageInfo may fail on some platforms; skip gracefully.
    }

    try {
      if (kIsWeb) {
        tags['device.platform'] = 'web';
      } else {
        final deviceInfo = DeviceInfoPlugin();
        if (defaultTargetPlatform == TargetPlatform.android) {
          final android = await deviceInfo.androidInfo;
          tags['device.platform'] = 'android';
          tags['device.osVersion'] = android.version.release;
          tags['device.model'] = android.model;
          tags['device.manufacturer'] = android.manufacturer;
        } else if (defaultTargetPlatform == TargetPlatform.iOS) {
          final ios = await deviceInfo.iosInfo;
          tags['device.platform'] = 'ios';
          tags['device.osVersion'] = ios.systemVersion;
          tags['device.model'] = ios.model;
          tags['device.name'] = ios.name;
        }
      }
    } catch (_) {
      // DeviceInfo may fail on some platforms; skip gracefully.
    }

    return tags;
  }
}
