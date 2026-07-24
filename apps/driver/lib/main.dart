import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'app.dart';
import 'core/firebase_config.dart';
import 'package:truxify_driver/config/env.dart';
import 'services/background_sync_service.dart';

Future<void> main() async {
  // Ensure Flutter engine is initialized.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize crash reporting as early as possible.
  // This wires up FlutterError.onError, PlatformDispatcher.onError,
  // and initializes the Sentry SDK (when SENTRY_DSN is configured).
  await CrashReportingService.init(appName: 'Driver');

  BackgroundSyncService.initialize();

  // ── Validate all required environment variables before app starts ────────
  Env.validate();  // Throws an error if SUPABASE_URL or SUPABASE_ANON_KEY are missing
  // ─────────────────────────────────────────────────────────────────────────────

  // Initialize Firebase.
  try {
    if (kIsWeb) {
      if (!FirebaseConfig.isConfigured) {
        debugPrint(
          'Firebase credentials not provided via --dart-define. '
          'Skipping Firebase web initialization.',
        );
      } else {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: FirebaseConfig.apiKey,
            appId: FirebaseConfig.appId,
            messagingSenderId: FirebaseConfig.messagingSenderId,
            projectId: FirebaseConfig.projectId,
            storageBucket: FirebaseConfig.storageBucket,
            authDomain: FirebaseConfig.authDomain,
          ),
        );
      }
    } else {
      await Firebase.initializeApp();
    }
  } catch (e) {
    debugPrint('Firebase initialization failed: $e');
  }

  // Initialize Supabase using environment variables.
  try {
    await Supabase.initialize(
      url: Env.supabaseUrl,
      publishableKey: Env.supabaseAnonKey,
    );
  } catch (e) {
    debugPrint('Supabase initialization failed: $e');
    // You may rethrow or handle gracefully; Env.validate already ensures they exist.
  }

  // Replace Flutter's default red error screen in release/profile builds.
  ErrorWidget.builder = TruxifyErrorWidget.builder;

  // Wrap runApp in a guarded zone to capture uncaught async errors.
  runZonedGuarded(() {
    runApp(const TruxifyApp());
  }, (error, stackTrace) {
    CrashReportingService.captureException(
      error,
      stackTrace: stackTrace,
      mechanism: 'runZonedGuarded',
    );
  });
}