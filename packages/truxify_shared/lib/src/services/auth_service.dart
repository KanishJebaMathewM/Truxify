import 'package:firebase_auth/firebase_auth.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide User;

/// Centralized Firebase Phone Authentication service.
///
/// Wraps [FirebaseAuth] to provide a clean API for phone number verification,
/// OTP confirmation, token management, and sign-out.
class AuthService {
  AuthService({FirebaseAuth? auth, SupabaseClient? supabase})
      : _auth = _resolveAuth(auth),
        _supabase = _resolveSupabase(supabase);

  static FirebaseAuth? _resolveAuth(FirebaseAuth? provided) {
    if (provided != null) return provided;
    try { return FirebaseAuth.instance; } catch (_) { return null; }
  }

  static SupabaseClient? _resolveSupabase(SupabaseClient? provided) {
    if (provided != null) return provided;
    try { return Supabase.instance.client; } catch (_) { return null; }
  }

  final FirebaseAuth? _auth;
  final SupabaseClient? _supabase;
  String? _lastAuthError;
  bool _isAuthenticating = false;

  bool get isAuthenticating => _isAuthenticating;
  String? get lastAuthError => _lastAuthError;

  void _clearError() => _lastAuthError = null;

  bool _validatePhone(String phone) {
    final clean = phone.replaceAll(RegExp(r'[\s\-()]'), '');
    if (!clean.startsWith('+')) {
      _lastAuthError = 'Phone must include country code (e.g. +91)';
      return false;
    }
    if (clean.length < 10 || clean.length > 15) {
      _lastAuthError = 'Invalid phone number length';
      return false;
    }
    return true;
  }

  bool _validateOtp(String otp) {
    if (otp.length != 6) {
      _lastAuthError = 'OTP must be 6 digits';
      return false;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(otp)) {
      _lastAuthError = 'OTP must contain only digits';
      return false;
    }
    return true;
  }

  /// Current authenticated user, or null if not signed in.
  User? get currentUser => _auth?.currentUser;

  /// Stream of auth state changes (sign-in / sign-out events).
  Stream<User?> get authStateChanges =>
      _auth?.authStateChanges() ?? const Stream.empty();

  /// Get the current Firebase ID token for API calls.
  Future<String?> getIdToken({bool forceRefresh = false}) async {
    return _auth?.currentUser?.getIdToken(forceRefresh);
  }

  /// Initiate phone number verification via Firebase.
  ///
  /// [phoneNumber] must include the country code (e.g., '+919876543210').
  Future<void> verifyPhoneNumber({
    required String phoneNumber,
    required void Function(String verificationId, int? resendToken) onCodeSent,
    required void Function(FirebaseAuthException e) onVerificationFailed,
    required void Function(PhoneAuthCredential credential) onAutoVerification,
    int? forceResendingToken,
    Duration timeout = const Duration(seconds: 60),
  }) async {
    if (_auth == null) {
      onVerificationFailed(
        FirebaseAuthException(
          code: 'auth-unavailable',
          message: 'Firebase Auth is not available.',
        ),
      );
      return;
    }
    await _auth.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      timeout: timeout,
      forceResendingToken: forceResendingToken,
      verificationCompleted: onAutoVerification,
      verificationFailed: onVerificationFailed,
      codeSent: onCodeSent,
      codeAutoRetrievalTimeout: (_) {},
    );
  }

  /// Verify the SMS OTP code and sign in.
  ///
  /// Throws [FirebaseAuthException] on invalid code, expired code, etc.
  Future<UserCredential> verifyOtp(
      String verificationId, String smsCode) async {
    if (_auth == null) throw Exception('Firebase Auth is not available');
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode,
    );
    return _auth.signInWithCredential(credential);
  }

  /// Sign out the current user.
  Future<void> signOut() async {
    await _auth?.signOut();
    try {
      await _supabase?.auth.signOut();
    } catch (_) {
      // Ignore if Supabase is not initialized or configured
    }
  }
}
