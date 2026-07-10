/// Configuration for Firebase.
/// Extracts values passed via --dart-define environment variables,
/// keeping secrets out of source control.
class FirebaseConfig {
  /// Firebase Web API Key.
  static const String apiKey = String.fromEnvironment('FIREBASE_API_KEY');

  /// Firebase App ID (driver web app).
  static const String appId = String.fromEnvironment('FIREBASE_APP_ID');

  /// Firebase Cloud Messaging Sender ID.
  static const String messagingSenderId =
      String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');

  /// Firebase Project ID.
  static const String projectId =
      String.fromEnvironment('FIREBASE_PROJECT_ID');

  /// Firebase Storage Bucket.
  static const String storageBucket =
      String.fromEnvironment('FIREBASE_STORAGE_BUCKET');

  /// Firebase Auth Domain.
  static const String authDomain =
      String.fromEnvironment('FIREBASE_AUTH_DOMAIN');

  /// Helper to check if all required Firebase credentials are provided.
  static bool get isConfigured =>
      apiKey.isNotEmpty &&
      appId.isNotEmpty &&
      messagingSenderId.isNotEmpty &&
      projectId.isNotEmpty;
}

class FirebaseSettings {
  static const bool useEmulator = bool.fromEnvironment('USE_FIREBASE_EMULATOR');
  static const String emulatorHost = String.fromEnvironment('FIREBASE_EMULATOR_HOST', defaultValue: 'localhost');
  static const int emulatorPort = int.fromEnvironment('FIREBASE_EMULATOR_PORT', defaultValue: 9099);
  static const String apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const String appId = String.fromEnvironment('FIREBASE_APP_ID');

  static bool get isConfigured => apiKey.isNotEmpty && projectId.isNotEmpty;
  static bool get isEmulatorMode => useEmulator && isConfigured;
  static String get messagingUrl => 'https://.firebaseio.com';
}
