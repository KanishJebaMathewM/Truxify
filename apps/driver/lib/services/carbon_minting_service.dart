import 'dart:async';
import '../models/carbon_token_model.dart';

class CarbonMintingService {
  Future<CarbonWalletState> getWalletState() async {
    await Future.delayed(const Duration(milliseconds: 500));
    return CarbonWalletState(
      walletAddress: '0x99A3...B44F',
      totalTokensBalance: 12450.0,
      marketPricePerTokenUsd: 0.045,
    );
  }

  Stream<CarbonMintSession> processTripEmissions(String tripId) async* {
    yield CarbonMintSession(
      tripId: tripId,
      distanceMiles: 450,
      baselineEmissionsKg: 700.0,
      actualEmissionsKg: 200.0, // Used EV truck
      emissionsSavedKg: 500.0,
      tokensMinted: 0.0,
      blockchainTxHash: 'Pending',
      status: 'Analyzing Telematics',
    );

    await Future.delayed(const Duration(seconds: 2));

    yield CarbonMintSession(
      tripId: tripId,
      distanceMiles: 450,
      baselineEmissionsKg: 700.0,
      actualEmissionsKg: 200.0,
      emissionsSavedKg: 500.0,
      tokensMinted: 0.0,
      blockchainTxHash: 'Pending Signatures...',
      status: 'Minting Tokens on Chain',
    );

    await Future.delayed(const Duration(seconds: 3));

    yield CarbonMintSession(
      tripId: tripId,
      distanceMiles: 450,
      baselineEmissionsKg: 700.0,
      actualEmissionsKg: 200.0,
      emissionsSavedKg: 500.0,
      tokensMinted: 500.0, // 1:1 ratio
      blockchainTxHash: '0x4f8e3...a12c',
      status: 'Minted Successfully',
    );
  }
}
