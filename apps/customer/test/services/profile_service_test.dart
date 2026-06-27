import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/services/profile_service.dart';
import 'package:truxify/services/supabase_service.dart';

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

    profileService = ProfileService(apiClient: apiClient);
  });

  tearDown(() {
    SupabaseService.mockClient = null;
  });

  test('fetchProfile calls ApiClient get and returns data', () async {
    when(() => apiClient.get('/api/profile', headers: any(named: 'headers')))
        .thenAnswer((_) async => {'id': 'user_123', 'email': 'john@example.com'});

    final profile = await profileService.fetchProfile();

    expect(profile['id'], equals('user_123'));
    expect(profile['email'], equals('john@example.com'));

    verify(() => apiClient.get('/api/profile', headers: any(named: 'headers'))).called(1);
  });

  test('fetchProfile translates ApiException to StateError', () async {
    when(() => apiClient.get('/api/profile', headers: any(named: 'headers')))
        .thenThrow(const ApiException(400, 'Bad Request'));

    expect(
      () => profileService.fetchProfile(),
      throwsA(isA<StateError>().having((e) => e.message, 'message', 'Bad Request')),
    );
  });
}
