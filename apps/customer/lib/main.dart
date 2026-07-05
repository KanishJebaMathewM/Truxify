import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'constants/firebase_config.dart';
import 'constants/supabase_config.dart';

void main() async {
  // Ensure Flutter engine is initialized.
  WidgetsFlutterBinding.ensureInitialized();

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
        anonKey: SupabaseConfig.anonKey,
      );
    } catch (e) {
      debugPrint('Supabase initialization failed: $e');
    }
  } else {
    debugPrint('Supabase URL/AnonKey not provided. Skipping initialization.');
  }

  runApp(const TruxifyApp());
}