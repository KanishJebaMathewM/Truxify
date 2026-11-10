import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('AuthService.verifyOtp', () {
    test('rejects an OTP that is too short before contacting Firebase', () async {
      final auth = MockFirebaseAuth();
      final service = AuthService(auth: auth);

      expect(
        () => service.verifyOtp('verification-id', '12'),
        throwsA(isA<ArgumentError>()),
      );
      // The flag must never be left dangling after a validation failure.
      expect(service.isAuthenticating, isFalse);
    });

    test('rejects a non-digit OTP before contacting Firebase', () async {
      final auth = MockFirebaseAuth();
      final service = AuthService(auth: auth);

      expect(
        () => service.verifyOtp('verification-id', 'abc123'),
        throwsA(isA<ArgumentError>()),
      );
      expect(service.isAuthenticating, isFalse);
    });

    test('signs in and clears the authenticating flag on success', () async {
      final auth = MockFirebaseAuth();
      final service = AuthService(auth: auth);

      final credential = await service.verifyOtp('verification-id', '123456');

      expect(credential, isA<UserCredential>());
      expect(service.isAuthenticating, isFalse);
    });

    test('isAuthenticating is true while the network call is in flight', () async {
      final auth = MockFirebaseAuth();
      final service = AuthService(auth: auth);

      final future = service.verifyOtp('verification-id', '123456');
      // The flag should be raised immediately around the network call.
      expect(service.isAuthenticating, isTrue);

      await future;
      expect(service.isAuthenticating, isFalse);
    });

    test('clears the flag even when sign-in fails', () async {
      // whenCalling() was a mockito<=4 API (removed in 5.x) — a hand-rolled
      // subclass does the same job with no extra dependency.
      final auth = _FailingCredentialAuth();
      final service = AuthService(auth: auth);

      expect(
        () => service.verifyOtp('verification-id', '123456'),
        throwsA(isA<FirebaseAuthException>()),
      );
      expect(service.isAuthenticating, isFalse);
    });
  });
}

class _FailingCredentialAuth extends MockFirebaseAuth {
  @override
  Future<UserCredential> signInWithCredential(AuthCredential? credential) {
    throw FirebaseAuthException(code: 'invalid-verification-code');
  }
}
