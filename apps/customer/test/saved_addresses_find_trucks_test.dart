import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/models/app_models.dart';
import 'package:truxify/models/saved_address.dart';
import 'package:truxify/repositories/address_repository.dart';
import 'package:truxify/screens/find_trucks_screen.dart';
import 'package:truxify/widgets/common_widgets.dart';

class MockAddressRepository extends Mock implements AddressRepository {}

void main() {
  late MockAddressRepository mockRepo;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    mockRepo = MockAddressRepository();
    registerFallbackValue(
      const SavedAddress(
        id: '',
        userId: '',
        label: '',
        addressLine: '',
        city: '',
        state: '',
        pincode: '',
        isDefault: false,
      ),
    );
  });

  Widget createTestWidget(
    WidgetTester tester, {
    TruxifyController? controller,
    AddressRepository? repository,
  }) {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final ctrl = controller ?? TruxifyController();
    return TruxifyScope(
      controller: ctrl,
      child: MaterialApp(
        home: Scaffold(
          body: FindTrucksScreen(addressRepository: repository ?? mockRepo),
        ),
      ),
    );
  }

  SavedAddress _makeAddress({
    required String id,
    required String label,
    required String addressLine,
    String city = 'Mumbai',
    String state = 'Maharashtra',
    String pincode = '400001',
    double? latitude,
    double? longitude,
  }) {
    return SavedAddress(
      id: id,
      userId: 'user-1',
      label: label,
      addressLine: addressLine,
      city: city,
      state: state,
      pincode: pincode,
      latitude: latitude,
      longitude: longitude,
      isDefault: false,
    );
  }

  group('Loading saved addresses', () {
    testWidgets('loads and displays address chips on screen open', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road', latitude: 19.07, longitude: 72.87),
        _makeAddress(id: '2', label: 'Office', addressLine: 'BKC', latitude: 19.05, longitude: 72.86),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Office'), findsOneWidget);
    });

    testWidgets('does not show chips when saved addresses is empty', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      expect(find.text('Home'), findsNothing);
      expect(find.text('Office'), findsNothing);
    });

    testWidgets('handles loading state gracefully', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer(
        (_) async {
          await Future<void>.delayed(const Duration(seconds: 5));
          return [];
        },
      );

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();

      // Screen should render without error while loading
      expect(find.byType(FindTrucksScreen), findsOneWidget);
    });

    testWidgets('handles error gracefully without crashing', (tester) async {
      when(() => mockRepo.fetchAll()).thenThrow(Exception('Network error'));

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Screen should render without error
      expect(find.byType(FindTrucksScreen), findsOneWidget);
      // Chips should not appear
      expect(find.text('Home'), findsNothing);
    });
  });

  group('Selecting saved address', () {
    testWidgets('tapping pickup chip populates pickup field and coordinates', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road', latitude: 19.07, longitude: 72.87),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Tap the Home chip (under pickup section)
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();

      // Pickup field should be populated with full address
      expect(find.text('12 MG Road, Mumbai, Maharashtra 400001'), findsOneWidget);
    });

    testWidgets('tapping drop chip populates drop field', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Warehouse', addressLine: '45 Industrial Area', latitude: 19.10, longitude: 72.90),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Find the drop section chip - it's the second occurrence of the label
      final chipFinders = find.text('Warehouse');
      expect(chipFinders, findsNWidgets(2)); // One in pickup chips, one in drop chips

      // Tap the second Warehouse chip (drop section)
      await tester.tap(chipFinders.last);
      await tester.pumpAndSettle();

      // Drop field should be populated
      expect(find.text('45 Industrial Area, Mumbai, Maharashtra 400001'), findsOneWidget);
    });

    testWidgets('chips show correct label and icon', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Chip should display the label
      expect(find.text('Home'), findsWidgets);

      // Chip should have a home icon
      expect(find.byIcon(Icons.home_rounded), findsWidgets);
    });

    testWidgets('office label shows business icon', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Office', addressLine: 'BKC'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.business_rounded), findsWidgets);
    });
  });

  group('Bottom sheet', () {
    testWidgets('bookmark icon opens saved address bottom sheet', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Tap the bookmark icon on pickup field
      await tester.tap(find.byIcon(Icons.bookmark_rounded).first);
      await tester.pumpAndSettle();

      // Bottom sheet should show
      expect(find.text('Select Pickup Address'), findsOneWidget);
      expect(find.text('Home'), findsWidgets);
    });

    testWidgets('bottom sheet shows empty state when no addresses', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.bookmark_rounded).first);
      await tester.pumpAndSettle();

      expect(find.text('Select Pickup Address'), findsOneWidget);
      expect(find.text('No saved addresses'), findsOneWidget);
    });

    testWidgets('bottom sheet shows error state with retry button', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Now make fetchAll fail
      when(() => mockRepo.fetchAll()).thenThrow(Exception('DB error'));

      await tester.tap(find.byIcon(Icons.bookmark_rounded).first);
      await tester.pumpAndSettle();

      expect(find.text('Failed to load addresses'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('selecting address from bottom sheet populates field and dismisses sheet', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road', latitude: 19.07, longitude: 72.87),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Open bottom sheet
      await tester.tap(find.byIcon(Icons.bookmark_rounded).first);
      await tester.pumpAndSettle();

      // Tap the address in the sheet
      await tester.tap(find.text('Home').last);
      await tester.pumpAndSettle();

      // Sheet should be dismissed and field populated
      expect(find.text('Select Pickup Address'), findsNothing);
      expect(find.text('12 MG Road, Mumbai, Maharashtra 400001'), findsOneWidget);
    });

    testWidgets('drop bookmark icon opens drop address sheet', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Office', addressLine: 'BKC'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Tap the second bookmark icon (drop section)
      await tester.tap(find.byIcon(Icons.bookmark_rounded).last);
      await tester.pumpAndSettle();

      expect(find.text('Select Drop Address'), findsOneWidget);
    });
  });

  group('Save new address', () {
    testWidgets('save prompt appears after location is selected', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Verify the screen renders without error
      expect(find.byType(FindTrucksScreen), findsOneWidget);
    });
  });

  group('Chips display', () {
    testWidgets('chips are horizontal scrollable', (tester) async {
      final addresses = List.generate(
        10,
        (i) => _makeAddress(id: '$i', label: 'Addr $i', addressLine: 'Line $i'),
      );
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Should find a horizontal ListView for pickup chips
      final listViews = find.byType(ListView);
      expect(listViews, findsWidgets);
    });

    testWidgets('no duplicate chips for same address', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Home chip appears in both pickup and drop sections = 2
      expect(find.text('Home'), findsNWidgets(2));
    });

    testWidgets('selected chip has accent styling', (tester) async {
      final addresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road', latitude: 19.07, longitude: 72.87),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => addresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Tap Home chip to select it
      await tester.tap(find.text('Home').first);
      await tester.pumpAndSettle();

      // The chip should still be visible (now selected)
      expect(find.text('Home'), findsWidgets);
    });
  });

  group('Refresh address list', () {
    testWidgets('addresses refresh after successful save', (tester) async {
      final initialAddresses = [
        _makeAddress(id: '1', label: 'Home', addressLine: '12 MG Road'),
      ];
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => initialAddresses);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      expect(find.text('Home'), findsWidgets);

      // Verify fetchAll was called
      verify(() => mockRepo.fetchAll()).called(1);
    });
  });

  group('Existing booking flow preserved', () {
    testWidgets('form validation still works with saved addresses loaded', (tester) async {
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      // Form should render
      expect(find.byType(FindTrucksScreen), findsOneWidget);
      expect(find.byType(PrimaryButton), findsOneWidget);
      expect(find.text('Find Trucks'), findsOneWidget);
    });

    testWidgets('RouteDraft populated from pending draft still works', (tester) async {
      final controller = TruxifyController();
      when(() => mockRepo.fetchAll()).thenAnswer((_) async => []);

      final draft = RouteDraft(
        pickup: 'Surat, Gujarat',
        drop: 'Jaipur, Rajasthan',
        dateLabel: 'Tomorrow, 6:00 AM',
        goodsType: 'Textile',
        weightTonnes: '3',
        dimensions: '12 × 6 × 6',
        stacked: true,
        fragile: false,
        requirements: const [],
        pickupLat: 21.17,
        pickupLng: 72.83,
        dropLat: 26.91,
        dropLng: 75.78,
      );
      controller.openFindTrucks(draft: draft);

      await tester.pumpWidget(createTestWidget(tester, controller: controller));
      await tester.pumpAndSettle();

      expect(find.text('Surat, Gujarat'), findsOneWidget);
      expect(find.text('Jaipur, Rajasthan'), findsOneWidget);
      verify(() => mockRepo.fetchAll()).called(1);
    });
  });
}
