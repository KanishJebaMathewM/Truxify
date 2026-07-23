import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

import 'app.dart';
import 'constants/firebase_config.dart';
import 'constants/supabase_config.dart';

void main() async {
  // Ensure Flutter engine is initialized.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize crash reporting as early as possible.
  // This wires up FlutterError.onError, PlatformDispatcher.onError,
  // and initializes the Sentry SDK (when SENTRY_DSN is configured).
  await CrashReportingService.init(appName: 'Customer');

  // Initialize Firebase (required for Phone Auth & FCM).
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

  // Initialize Supabase if keys are provided.
  if (SupabaseConfig.isConfigured) {
    try {
      await Supabase.initialize(
        url: SupabaseConfig.url,
        publishableKey: SupabaseConfig.publishableKey,
      );
    } catch (e) {
      debugPrint('Supabase initialization failed: $e');
    }
  } else {
    debugPrint('Supabase URL/AnonKey not provided. Skipping initialization.');
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