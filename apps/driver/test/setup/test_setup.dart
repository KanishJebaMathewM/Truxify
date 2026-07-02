import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Setup test environment with all required initializations.
Future<void> setupTestEnvironment() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  setupFirebaseCoreMocks();
  SharedPreferences.setMockInitialValues({});

  try {
    await Supabase.initialize(
      url: 'https://mock-project.supabase.co',
      anonKey: 'mock-anon-key',
    );
    print('Supabase initialized for tests');
  } catch (e) {
    print('Supabase already initialized: $e');
  }

  try {
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: 'mock-api-key',
        appId: 'mock-app-id',
        messagingSenderId: 'mock-sender-id',
        projectId: 'mock-project-id',
      ),
    );
    print('Firebase initialized for tests');
  } catch (e) {
    print('Firebase already initialized: $e');
  }
}
