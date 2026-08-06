import 'dart:async';
import '../models/ar_cargo_model.dart';

class ArLoadingService {
  Future<List<ArPallet>> getLoadPlan() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      ArPallet(
        palletId: 'PAL-991A',
        destination: 'Chicago, IL (Drop 2)',
        weightLbs: 2100,
        isFragile: false,
        suggestedPosition: 'Row 1, Left (Nose)',
        colorCode: 'BLUE',
        isPlaced: false,
      ),
      ArPallet(
        palletId: 'PAL-992B',
        destination: 'Chicago, IL (Drop 2)',
        weightLbs: 1800,
        isFragile: false,
        suggestedPosition: 'Row 1, Right (Nose)',
        colorCode: 'BLUE',
        isPlaced: false,
      ),
      ArPallet(
        palletId: 'PAL-881C',
        destination: 'Indianapolis, IN (Drop 1)',
        weightLbs: 1200,
        isFragile: true,
        suggestedPosition: 'Row 10, Center (Tail)', // LIFO
        colorCode: 'ORANGE',
        isPlaced: false,
      ),
    ];
  }
}
