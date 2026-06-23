import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'constants/supabase_config.dart';

void main() async {
  // Ensure Flutter engine is initialized.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Firebase (required for Phone Auth & FCM).
  try {
    if (kIsWeb) {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: 'AIzaSyC7bLp9eoL0TZCT-t4iixlGQOKqzcGgEuA',
          appId: '1:833592679378:web:c53ae067c533000ee2860b',
          messagingSenderId: '833592679378',
          projectId: 'truxify-auth-prod',
          storageBucket: 'truxify-auth-prod.firebasestorage.app',
          authDomain: 'truxify-auth-prod.firebaseapp.com',
        ),
      );
    } else {
      await Firebase.initializeApp();
    }
  } catch (e) {
    debugPrint('Firebase initialization failed: $e');
    rethrow;
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