import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/services/profile_service.dart';
import 'package:truxify/services/supabase_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class MockApiClient extends Mock implements ApiClient {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}

void main() {
  late MockApiClient apiClient;
  late MockSupabaseClient supabaseClient;
  late MockGoTrueClient authClient;
  late MockUser user;
  late ProfileService profileService;

  setUp(() {
    apiClient = MockApiClient();
    supabaseClient = MockSupabaseClient();
    authClient = MockGoTrueClient();
    user = MockUser();

    SupabaseService.mockClient = supabaseClient;

    when(() => supabaseClient.auth).thenReturn(authClient);
    when(() => authClient.currentUser).thenReturn(user);
    when(() => user.id).thenReturn('user_123');
    when(() => user.userMetadata).thenReturn({'full_name': 'John Doe'});

    SharedPreferences.setMockInitialValues({});
    profileService = ProfileService(apiClient: apiClient);
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

    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString('truxify_profile_cache');
    expect(cached, isNotNull);
    expect(jsonDecode(cached!)['email'], equals('john@example.com'));
  });

  test('fetchProfile returns cached data on ApiException if available', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('truxify_profile_cache', jsonEncode({'id': 'user_123', 'email': 'cached@example.com'}));

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
