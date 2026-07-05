import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/services/profile_service.dart';
import 'package:truxify/services/supabase_service.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'dart:convert';

class MockApiClient extends Mock implements ApiClient {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}
class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockApiClient apiClient;
  late MockSupabaseClient supabaseClient;
  late MockGoTrueClient authClient;
  late MockUser user;
  late MockFlutterSecureStorage secureStorage;
  late ProfileService profileService;
  late Map<String, String> mockStorage;

  setUp(() {
    apiClient = MockApiClient();
    supabaseClient = MockSupabaseClient();
    authClient = MockGoTrueClient();
    user = MockUser();
    secureStorage = MockFlutterSecureStorage();
    mockStorage = <String, String>{};

    SupabaseService.mockClient = supabaseClient;

    when(() => supabaseClient.auth).thenReturn(authClient);
    when(() => authClient.currentUser).thenReturn(user);
    when(() => user.id).thenReturn('user_123');
    when(() => user.userMetadata).thenReturn({'full_name': 'John Doe'});

    // Mock write
    when(() => secureStorage.write(
          key: any(named: 'key'),
          value: any(named: 'value'),
          aOptions: any(named: 'aOptions'),
          iOptions: any(named: 'iOptions'),
        )).thenAnswer((invocation) async {
      final key = invocation.namedArguments[#key] as String;
      final value = invocation.namedArguments[#value] as String;
      mockStorage[key] = value;
    });

    // Mock read
    when(() => secureStorage.read(
          key: any(named: 'key'),
          aOptions: any(named: 'aOptions'),
          iOptions: any(named: 'iOptions'),
        )).thenAnswer((invocation) async {
      final key = invocation.namedArguments[#key] as String;
      return mockStorage[key];
    });

    // Mock delete
    when(() => secureStorage.delete(
          key: any(named: 'key'),
          aOptions: any(named: 'aOptions'),
          iOptions: any(named: 'iOptions'),
        )).thenAnswer((invocation) async {
      final key = invocation.namedArguments[#key] as String;
      mockStorage.remove(key);
    });

    profileService = ProfileService(apiClient: apiClient, secureStorage: secureStorage);
  });

  tearDown(() {
    SupabaseService.mockClient = null;
  });

  test('fetchProfile calls ApiClient get and returns data, also caching it', () async {
    when(() => apiClient.get('/api/profile'))
        .thenAnswer((_) async => {'id': 'user_123', 'email': 'john@example.com'});

    final profile = await profileService.fetchProfile();

    expect(profile['id'], equals('user_123'));
    expect(profile['email'], equals('john@example.com'));

    verify(() => apiClient.get('/api/profile')).called(1);

    expect(mockStorage['truxify_profile_cache'], isNotNull);
    expect(jsonDecode(mockStorage['truxify_profile_cache']!)['email'], equals('john@example.com'));
  });

  test('fetchProfile returns cached data on ApiException if available', () async {
    mockStorage['truxify_profile_cache'] = jsonEncode({'id': 'user_123', 'email': 'cached@example.com'});

    when(() => apiClient.get('/api/profile'))
        .thenThrow(const ApiException(400, 'Bad Request'));

    final profile = await profileService.fetchProfile();
    expect(profile['email'], equals('cached@example.com'));
  });

  test('fetchProfile throws StateError on ApiException if no cache is available', () async {
    when(() => apiClient.get('/api/profile'))
        .thenThrow(const ApiException(400, 'Bad Request'));

    expect(
      () => profileService.fetchProfile(),
      throwsA(isA<StateError>().having((e) => e.message, 'message', 'Bad Request')),
    );
  });
}
