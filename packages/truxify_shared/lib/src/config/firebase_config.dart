/// Configuration for Firebase.
/// Extracts values passed via --dart-define environment variables,
/// keeping secrets out of source control.
class FirebaseConfig {
  /// Firebase Web API Key.
  static const String apiKey = String.fromEnvironment('FIREBASE_API_KEY');

  /// Firebase App ID.
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
