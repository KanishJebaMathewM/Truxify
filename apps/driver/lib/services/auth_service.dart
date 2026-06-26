import 'package:firebase_auth/firebase_auth.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide User;

/// Centralized Firebase Phone Authentication service for the Driver app.
class AuthService {
  AuthService({FirebaseAuth? auth, SupabaseClient? supabase})
      : _auth = auth ?? FirebaseAuth.instance,
        _supabase = supabase ?? Supabase.instance.client;

  final FirebaseAuth _auth;
  final SupabaseClient _supabase;

  /// Current authenticated user.
  User? get currentUser => _auth.currentUser;

  /// Stream of auth state changes.
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Get the current Firebase ID token for API calls.
  Future<String?> getIdToken({bool forceRefresh = false}) async {
    return _auth.currentUser?.getIdToken(forceRefresh);
  }

  /// Initiate phone number verification.
  Future<void> verifyPhoneNumber({
    required String phoneNumber,
    required void Function(String verificationId, int? resendToken) onCodeSent,
    required void Function(FirebaseAuthException e) onVerificationFailed,
    required void Function(PhoneAuthCredential credential) onAutoVerification,
    int? forceResendingToken,
    Duration timeout = const Duration(seconds: 60),
  }) async {
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

  /// Verify the OTP code and sign in.
  Future<UserCredential> verifyOtp(String verificationId, String smsCode) async {
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode,
    );
    return _auth.signInWithCredential(credential);
  }

  /// Sign out.
  Future<void> signOut() async {
    await _auth.signOut();
    try {
      await _supabase.auth.signOut();
    } catch (_) {
      // Ignore if Supabase is not initialized or configured
    }
  }
}
