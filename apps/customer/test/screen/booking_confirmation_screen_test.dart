import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/l10n/app_localizations.dart';
import 'package:truxify/models/app_models.dart';
import 'package:truxify/models/payment_method.dart';
import 'package:truxify/models/saved_address.dart';
import 'package:truxify/repositories/address_repository.dart';
import 'package:truxify/repositories/payment_repository.dart';
import 'package:truxify/screens/booking_confirmation_screen.dart';
import 'package:truxify/services/order_service.dart';

class MockOrderService extends Mock implements OrderService {}
class MockApiClient extends Mock implements ApiClient {}
class MockPaymentRepository extends Mock implements PaymentRepository {}
class MockAddressRepository extends Mock implements AddressRepository {}

const _draft = RouteDraft(
  pickup: 'Surat, Gujarat',
  drop: 'Mumbai, Maharashtra',
  dateLabel: 'Today, 10:00 AM',
  goodsType: 'General',
  weightTonnes: '10',
  dimensions: '10 x 5 x 5 ft',
  stacked: false,
  fragile: false,
  requirements: [],
  pickupLat: 21.17,
  pickupLng: 72.83,
  dropLat: 19.07,
  dropLng: 72.87,
);

const _truck = TruckResultData(
  driver: 'Suresh Kumar',
  rating: 4.5,
  truck: 'Eicher 14FT',
  capacity: '10 Ton',
  price: '₹12000',
  eta: '3 hrs',
  baseFreight: '₹11000',
  tollEstimate: '₹500',
  platformFee: '₹500',
  truckNumber: 'GJ-05-XX-1234',
);

const _paymentMethod = PaymentMethod(
  id: 'pm-1',
  userId: 'u-1',
  methodType: 'UPI',
  displayLabel: 'GPay',
  isDefault: true,
);

const _savedAddress = SavedAddress(
  id: 'addr-1',
  userId: 'u-1',
  label: 'Home',
  addressLine: '1 MG Road',
  city: 'Surat',
  state: 'Gujarat',
  pincode: '395001',
  latitude: 21.17,
  longitude: 72.83,
  isDefault: true,
);

void main() {
  late MockOrderService mockOrderService;
  late MockApiClient mockApiClient;
  late MockPaymentRepository mockPaymentRepository;
  late MockAddressRepository mockAddressRepository;

  setUp(() {
    mockOrderService = MockOrderService();
    mockApiClient = MockApiClient();
    mockPaymentRepository = MockPaymentRepository();
    mockAddressRepository = MockAddressRepository();

    when(() => mockPaymentRepository.fetchAll())
        .thenAnswer((_) async => [_paymentMethod]);
    when(() => mockAddressRepository.fetchAll())
        .thenAnswer((_) async => [_savedAddress]);
    when(() => mockOrderService.createOrder(
      pickupAddress: any(named: 'pickupAddress'),
      dropAddress: any(named: 'dropAddress'),
      pickupLat: any(named: 'pickupLat'),
      pickupLng: any(named: 'pickupLng'),
      dropLat: any(named: 'dropLat'),
      dropLng: any(named: 'dropLng'),
      pickupTime: any(named: 'pickupTime'),
      goodsType: any(named: 'goodsType'),
      weightTonnes: any(named: 'weightTonnes'),
      paymentMethodId: any(named: 'paymentMethodId'),
      upiId: any(named: 'upiId'),
      pickupDate: any(named: 'pickupDate'),
      requiresRefrigeration: any(named: 'requiresRefrigeration'),
      targetTemperatureMin: any(named: 'targetTemperatureMin'),
      targetTemperatureMax: any(named: 'targetTemperatureMax'),
    )).thenAnswer((_) async => 'order-123');
    when(() => mockApiClient.post(
      any(),
      body: any(named: 'body'),
    )).thenAnswer((_) async => {
      'deep_link': 'upi://pay?pa=truxify@upi&am=120.00&cu=INR&tr=TX-123',
      'amount_inr': '120.00',
      'order_ref': 'TX-123',
    });
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    Map<String, dynamic>? statusResponse,
    bool statusError = false,
  }) async {
    tester.view.physicalSize = const Size(800, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    if (statusError) {
      when(() => mockApiClient.get(any()))
          .thenThrow(Exception('network down'));
    } else {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => statusResponse ?? {'escrow_status': 'funded'},
      );
    }

    await tester.pumpWidget(
      TruxifyScope(
        controller: TruxifyController(),
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: BookingConfirmationScreen(
            draft: _draft,
            truck: _truck,
            orderService: mockOrderService,
            paymentRepository: mockPaymentRepository,
            addressRepository: mockAddressRepository,
            apiClient: mockApiClient,
          ),
        ),
      ),
    );
    await tester.pump(); // checkout data load
    await tester.pump(); // rebuild with loaded data
  }

  Future<void> reachUpiSheet(WidgetTester tester) async {
    await tester.tap(find.text('Pay & Confirm'));
    await tester.pump(); // create order
    await tester.pump(); // upi intent resolves -> UPI sheet
    expect(find.text('Booking created!'), findsOneWidget);
  }

  group('BookingConfirmationScreen payment flow', () {
    testWidgets('shows the success panel when escrow status is funded',
        (tester) async {
      await pumpScreen(tester);

      await reachUpiSheet(tester);

      await tester.tap(find.textContaining("I've Paid"));
      await tester.pump(); // confirm starts
      await tester.pump(); // status poll resolves -> success state

      expect(find.textContaining('Booking Confirmed'), findsOneWidget);

      // Flush the auto-navigation timer so no timers leak after teardown.
      await tester.pump(const Duration(milliseconds: 1900));
      await tester.pump();
    });

    testWidgets('shows a retryable pending state while escrow is still funding',
        (tester) async {
      await pumpScreen(
        tester,
        statusResponse: {'escrow_status': 'funding'},
      );

      await reachUpiSheet(tester);

      await tester.tap(find.textContaining("I've Paid"));
      await tester.pump();
      await tester.pump();

      expect(find.text('Verifying your payment'), findsOneWidget);
      expect(find.text('Check payment status'), findsOneWidget);
      expect(find.text('Back to bookings'), findsOneWidget);
    });

    testWidgets('shows the pending state with retry when verification errors',
        (tester) async {
      await pumpScreen(tester, statusError: true);

      await reachUpiSheet(tester);

      await tester.tap(find.textContaining("I've Paid"));
      await tester.pump();
      await tester.pump();

      expect(find.text('Verifying your payment'), findsOneWidget);
      expect(find.textContaining('could not verify'), findsOneWidget);
      expect(find.text('Check payment status'), findsOneWidget);
    });
  });
}
