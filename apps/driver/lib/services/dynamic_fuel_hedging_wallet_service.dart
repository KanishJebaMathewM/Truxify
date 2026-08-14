import 'dart:async';
import '../models/dynamic_fuel_hedging_wallet_model.dart';

class DynamicFuelHedgingWalletService {
  Future<FuelHedgingWallet> getWalletDashboard() async {
    await Future.delayed(const Duration(seconds: 1));
    return FuelHedgingWallet(
      availableBalanceUsd: 12500.00,
      activeContracts: [
        FuelFutureContract(
          contractId: 'HEDGE-TX-8812',
          stationChain: 'Pilot Flying J',
          gallonsLocked: 150.0,
          lockedPricePerGallonUsd: 3.10,
          currentPumpPriceUsd: 3.45, // Saved $0.35/gal!
          expiresAt: DateTime.now().add(const Duration(days: 2)),
          locationArea: 'I-10 Corridor (TX)',
          isRedeemed: false,
        ),
        FuelFutureContract(
          contractId: 'HEDGE-CA-9921',
          stationChain: 'Love\'s Travel Stops',
          gallonsLocked: 100.0,
          lockedPricePerGallonUsd: 4.85,
          currentPumpPriceUsd: 5.10, // Saved $0.25/gal!
          expiresAt: DateTime.now().add(const Duration(days: 5)),
          locationArea: 'Southern California',
          isRedeemed: false,
        ),
      ],
    );
  }

  Future<bool> redeemContract(String contractId) async {
    // Simulate cryptographic redemption at the pump
    await Future.delayed(const Duration(seconds: 2));
    return true;
  }
  
  Future<bool> purchaseNewHedge(double gallons, double price, String location) async {
    await Future.delayed(const Duration(seconds: 2));
    return true;
  }
}
