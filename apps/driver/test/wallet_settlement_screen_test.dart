import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/smart_contract_payment_model.dart';
import 'package:truxify_driver/screens/wallet_settlement_screen.dart';
import 'package:truxify_driver/services/smart_contract_payment_service.dart';

/// Regression coverage for GitHub issue #12006.
///
/// `_buildContractCard` gated the release button on
/// `geoFenceBreached && !bolSigned`. A contract whose BOL was signed through
/// another path but whose escrow had not settled matched neither `isSettled`
/// nor `canSettle`, so the card fell through to the status-text branch: no
/// badge, no button, and no way for the driver to claim funds already earned.

/// Fake service with the artificial network delays removed so `pumpAndSettle`
/// resolves. Mirrors the real contract: settlement returns a signed, settled
/// copy of the escrow.
class _FakePaymentService extends SmartContractPaymentService {
  _FakePaymentService(this.contracts);

  final List<SmartContractPayment> contracts;
  int executeCallCount = 0;

  @override
  Future<List<SmartContractPayment>> getActiveContracts() async => contracts;

  @override
  Future<SmartContractPayment> executeSmartContract(
      SmartContractPayment contract) async {
    executeCallCount++;
    return SmartContractPayment(
      contractId: contract.contractId,
      loadId: contract.loadId,
      brokerName: contract.brokerName,
      amountUsd: contract.amountUsd,
      cryptoEquivalent: contract.cryptoEquivalent,
      geoFenceBreached: true,
      bolSigned: true,
      status: 'Settled',
      settlementTime: DateTime.now(),
    );
  }
}

SmartContractPayment _contract({
  required bool geoFenceBreached,
  required bool bolSigned,
  required String status,
}) {
  return SmartContractPayment(
    contractId: '0x8f2a...4b1c',
    loadId: 'LD-99321',
    brokerName: 'TQL Logistics',
    amountUsd: 2150.00,
    cryptoEquivalent: '2150.00 USDC',
    geoFenceBreached: geoFenceBreached,
    bolSigned: bolSigned,
    status: status,
  );
}

Future<_FakePaymentService> _pumpScreen(
  WidgetTester tester,
  SmartContractPayment contract,
) async {
  final service = _FakePaymentService([contract]);
  await tester.pumpWidget(
    MaterialApp(home: WalletSettlementScreen(paymentService: service)),
  );
  await tester.pumpAndSettle();
  return service;
}

void main() {
  testWidgets(
      'geo-fence breached with BOL already signed still exposes the release action',
      (WidgetTester tester) async {
    await _pumpScreen(
      tester,
      _contract(
        geoFenceBreached: true,
        bolSigned: true,
        status: 'Awaiting Settlement',
      ),
    );

    // The bug: this card rendered only 'AWAITING SETTLEMENT' with no action.
    expect(find.text('RELEASE FUNDS'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsOneWidget);
    expect(find.text('AWAITING SETTLEMENT'), findsNothing);
  });

  testWidgets('unsigned BOL keeps the sign-and-release action',
      (WidgetTester tester) async {
    await _pumpScreen(
      tester,
      _contract(
        geoFenceBreached: true,
        bolSigned: false,
        status: 'Awaiting BOL Signature',
      ),
    );

    expect(find.text('SIGN BOL & RELEASE FUNDS'), findsOneWidget);
    expect(find.text('AWAITING BOL SIGNATURE'), findsNothing);
  });

  testWidgets('settled contract shows the badge and offers no action',
      (WidgetTester tester) async {
    await _pumpScreen(
      tester,
      _contract(geoFenceBreached: true, bolSigned: true, status: 'Settled'),
    );

    expect(find.text('SETTLED'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
  });

  testWidgets('undelivered contract shows status only',
      (WidgetTester tester) async {
    await _pumpScreen(
      tester,
      _contract(
        geoFenceBreached: false,
        bolSigned: false,
        status: 'Awaiting Delivery',
      ),
    );

    expect(find.text('AWAITING DELIVERY'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
  });

  testWidgets('releasing an already-signed contract settles it exactly once',
      (WidgetTester tester) async {
    final service = await _pumpScreen(
      tester,
      _contract(
        geoFenceBreached: true,
        bolSigned: true,
        status: 'Awaiting Settlement',
      ),
    );

    await tester.tap(find.text('RELEASE FUNDS'));
    await tester.pumpAndSettle();

    expect(service.executeCallCount, 1);
    expect(find.text('SETTLED'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
  });

  testWidgets('a double tap does not execute the contract twice',
      (WidgetTester tester) async {
    final service = await _pumpScreen(
      tester,
      _contract(
        geoFenceBreached: true,
        bolSigned: false,
        status: 'Awaiting BOL Signature',
      ),
    );

    // The handler is invoked directly rather than tapped twice: once the modal
    // barrier is mounted a second `tap()` no longer hit-tests, so it cannot
    // reproduce the window a real double tap exploits — the two presses that
    // land before the first `showDialog` renders.
    final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
    button.onPressed!();
    button.onPressed!();
    await tester.pumpAndSettle();

    expect(service.executeCallCount, 1);
    expect(find.text('SETTLED'), findsOneWidget);
  });
}
