import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/core/supabase_config.dart';

void main() {
  group('SupabaseConfig Tests', () {
    test('Config parameters are read from environment', () {
      final isConfigured = SupabaseConfig.isConfigured;
      expect(SupabaseConfig.url, isA<String>());
      expect(SupabaseConfig.anonKey, isA<String>());
      expect(isConfigured, equals(SupabaseConfig.url.isNotEmpty && SupabaseConfig.anonKey.isNotEmpty));
    });
  });
}
