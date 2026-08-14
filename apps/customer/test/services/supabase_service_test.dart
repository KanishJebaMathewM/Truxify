import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/services/supabase_service.dart';

class FakeUser implements User {
  final String _id;
  final String? _email;
  final String? _phone;
  final Map<String, dynamic>? _metadata;
  FakeUser(this._id, {String? email, String? phone, Map<String, dynamic>? metadata})
      : _email = email,
        _phone = phone,
        _metadata = metadata;

  @override
  String get id => _id;

  @override
  String? get email => _email;

  @override
  String? get phone => _phone;

  @override
  Map<String, dynamic>? get userMetadata => _metadata;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeGoTrueClient implements GoTrueClient {
  FakeGoTrueClient(this._user);

  final User? _user;

  @override
  User? get currentUser => _user;

  @override
  Session? get currentSession => _user == null ? null : Session(null);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeSupabaseClient implements SupabaseClient {
  FakeSupabaseClient({GoTrueClient? auth}) : _auth = auth ?? FakeGoTrueClient(null);

  final GoTrueClient _auth;

  @override
  GoTrueClient get auth => _auth;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  tearDown(() {
    SupabaseService.mockClient = null;
  });

  group('SupabaseService accessors', () {
    test('currentUser/currentUserId return the mock user', () {
      SupabaseService.mockClient = FakeSupabaseClient(
        auth: FakeGoTrueClient(FakeUser('user-1', email: 'a@b.com', phone: '123', metadata: {'role': 'admin'})),
      );

      expect(SupabaseService.currentUser, isNotNull);
      expect(SupabaseService.currentUserId, 'user-1');
      expect(SupabaseService.currentUserEmail, 'a@b.com');
      expect(SupabaseService.currentUserPhone, '123');
      expect(SupabaseService.isAuthenticated, isTrue);
      expect(SupabaseService.userMetadata, {'role': 'admin'});
    });

    test('accessors return null when no user is authenticated', () {
      SupabaseService.mockClient = FakeSupabaseClient();

      expect(SupabaseService.currentUser, isNull);
      expect(SupabaseService.currentUserId, isNull);
      expect(SupabaseService.currentUserEmail, isNull);
      expect(SupabaseService.isAuthenticated, isFalse);
      expect(SupabaseService.userMetadata, isNull);
    });

    test('requireUserId returns id when authenticated', () {
      SupabaseService.mockClient = FakeSupabaseClient(
        auth: FakeGoTrueClient(FakeUser('user-1')),
      );

      expect(SupabaseService.requireUserId(), 'user-1');
    });

    test('requireUserId throws when not authenticated', () {
      SupabaseService.mockClient = FakeSupabaseClient();

      expect(() => SupabaseService.requireUserId(), throwsStateError);
    });
  });

  group('SupabaseService.signOut', () {
    test('delegates to client.auth.signOut', () async {
      var signedOut = false;
      final client = FakeSupabaseClient(auth: _FakeSignOutGoTrueClient(() => signedOut = true));
      SupabaseService.mockClient = client;

      await SupabaseService.signOut();

      expect(signedOut, isTrue);
    });
  });
}

class _FakeSignOutGoTrueClient implements GoTrueClient {
  _FakeSignOutGoTrueClient(this._onSignOut);
  final VoidCallback _onSignOut;

  @override
  User? get currentUser => null;

  @override
  Future<void> signOut() async {
    _onSignOut();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
