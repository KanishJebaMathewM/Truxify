import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_service.dart';

class OrderService {
  OrderService({
    SupabaseClient? client,
    http.Client? httpClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = _normalizeBaseUrl(apiBaseUrl ?? defaultApiBaseUrl);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  final http.Client _httpClient;
  final String _apiBaseUrl;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  Future<String> createOrder({
    required String pickupAddress,
    required String dropAddress,
    required double pickupLat,
    required double pickupLng,
    required double dropLat,
    required double dropLng,
    required String pickupTime,
    required String goodsType,
    required double weightTonnes,
    String? paymentMethodId,
    String? upiId,
  }) async {
    final user = SupabaseService.currentUser;
    final userId = SupabaseService.requireUserId();
    final token = _client.auth.currentSession?.accessToken;
    final fullName = user?.userMetadata?['full_name']?.toString();

    final response = await _httpClient.post(
      Uri.parse('$_apiBaseUrl/api/orders'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
        if (fullName != null && fullName.isNotEmpty) 'x-user-name': fullName,
      },
      body: jsonEncode(<String, dynamic>{
        'pickup_address': pickupAddress,
        'pickup_lat': pickupLat,
        'pickup_lng': pickupLng,
        'drop_address': dropAddress,
        'drop_lat': dropLat,
        'drop_lng': dropLng,
        'pickup_date': DateTime.now().toIso8601String(),
        'pickup_time': pickupTime,
        'goods_type': goodsType,
        'weight_tonnes': weightTonnes,
        'payment_method_id': paymentMethodId,
        'upi_id': upiId,
      }),
    );

    final body = response.body.isNotEmpty
        ? jsonDecode(response.body) as Map<String, dynamic>
        : <String, dynamic>{};

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        body['error']?.toString() ?? 'Failed to create order via backend API.',
      );
    }

    return body['order']?['order_display_id']?.toString() ?? '';
  }

  Future<Map<String, dynamic>?> fetchOrderById(String orderDisplayId) async {
    final userId = SupabaseService.requireUserId();

    final response = await _client
        .from('orders')
        .select()
        .eq('order_display_id', orderDisplayId)
        .eq('customer_id', userId)
        .maybeSingle();

    return response;
  }

  Future<List<Map<String, dynamic>>> fetchOrders() async {
    final userId = SupabaseService.requireUserId();

    final response = await _client
        .from('orders')
        .select()
        .eq('customer_id', userId)
        .order('pickup_date', ascending: false);

    debugPrint('Orders response: $response');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<void> _verifyOrderOwnership(
    String orderDisplayId,
    String customerId,
  ) async {
    final orderCheck = await _client
        .from('orders')
        .select('id')
        .eq('order_display_id', orderDisplayId)
        .eq('customer_id', customerId)
        .maybeSingle();

    if (orderCheck == null) {
      throw Exception('Unauthorized access to order data');
    }
  }

  Future<List<Map<String, dynamic>>> fetchOrderTimeline(
    String orderDisplayId,
  ) async {
    final customerId = SupabaseService.requireUserId();
    await _verifyOrderOwnership(orderDisplayId, customerId);

    final response = await _client
        .from('order_timeline')
        .select()
        .eq('order_display_id', orderDisplayId)
        .order('sort_order');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchActiveOrders() async {
    final userId = SupabaseService.requireUserId();

    final response = await _client
        .from('orders')
        .select()
        .eq('customer_id', userId)
        .inFilter('status', ['pending', 'active', 'in_transit']);

    final orders = List<Map<String, dynamic>>.from(response);

    final driverIds = orders
        .where((o) => o['driver_id'] != null)
        .map((o) => o['driver_id'].toString())
        .toSet()
        .toList();

    if (driverIds.isNotEmpty) {
      final profilesResponse = await _client
          .from('profiles')
          .select('id, full_name')
          .inFilter('id', driverIds);

      final profiles = List<Map<String, dynamic>>.from(profilesResponse);

      final driverMap = {
        for (final profile in profiles)
          profile['id'].toString(): profile['full_name']
      };

      for (final order in orders) {
        order['driver_name'] =
            driverMap[order['driver_id']?.toString()] ?? 'Driver Assigned';
      }
    }

    return orders;
  }

  Future<List<Map<String, dynamic>>> fetchHistoryOrders() async {
    final userId = SupabaseService.requireUserId();

    final response = await _client
        .from('orders')
        .select()
        .eq('customer_id', userId)
        .inFilter('status', [
      'completed',
      'delivered',
      'payment_released',
      'cancelled',
    ]);

    final orders = List<Map<String, dynamic>>.from(response);

    final driverIds = orders
        .where((o) => o['driver_id'] != null)
        .map((o) => o['driver_id'].toString())
        .toSet()
        .toList();

    if (driverIds.isNotEmpty) {
      final profilesResponse = await _client
          .from('profiles')
          .select('id, full_name')
          .inFilter('id', driverIds);

      final profiles = List<Map<String, dynamic>>.from(profilesResponse);

      final driverMap = {
        for (final profile in profiles)
          profile['id'].toString(): profile['full_name']
      };

      for (final order in orders) {
        order['driver_name'] =
            driverMap[order['driver_id']?.toString()] ?? 'Driver Assigned';
      }
    }

    return orders;
  }
}
