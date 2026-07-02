import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:firebase_core/firebase_core.dart';

void setupTestEnvironment() {
  TestWidgetsFlutterBinding.ensureInitialized();
  
  try {
    Supabase.initialize(
      url: 'https://mock-project.supabase.co',
      anonKey: 'mock-anon-key',
    );
  } catch (_) {}
  
  try {
    Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: 'mock-api-key',
        appId: 'mock-app-id',
        messagingSenderId: 'mock-sender-id',
        projectId: 'mock-project-id',
      ),
    );
  } catch (_) {}
}
