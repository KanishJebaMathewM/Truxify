import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> setupTests() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  setupFirebaseCoreMocks();

  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues({});

  if (Firebase.apps.isEmpty) {
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: 'mock-api-key',
          appId: 'mock-app-id',
          messagingSenderId: 'mock-sender-id',
          projectId: 'mock-project-id',
        ),
      );
    } on FirebaseException catch (e) {
      debugPrint('Firebase initialization failed: $e');
    }
  }

  try {
    Supabase.instance;
  } on AssertionError {
    await Supabase.initialize(
      url: 'http://localhost:54321',
      publishableKey: 'mock-anon-key',
    );
  }
}
