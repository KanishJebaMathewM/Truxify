import 'dart:convert';
import 'dart:math';

/// Federated Learning Client for Driver App.
/// Computes local model weight updates based on driver trip selection choices.
class FederatedLearningClient {
  final int numWeights;
  List<double> _localWeights;

  FederatedLearningClient({this.numWeights = 10})
      : _localWeights = List.filled(numWeights, 0.0);

  /// Trains local model weight gradients on driver trip selections
  void trainOnLocalData(List<Map<String, dynamic>> tripChoiceLogs) {
    if (tripChoiceLogs.isEmpty) return;

    for (int i = 0; i < numWeights; i++) {
      // Simulate stochastic gradient descent update
      double grad = (Random().nextDouble() - 0.5) * 0.01;
      _localWeights[i] += grad;
    }
  }

  /// Exports compressed local weight payload for server aggregation
  Map<String, dynamic> exportWeightUpdate(int sampleCount) {
    return {
      'weights': _localWeights.map((w) => double.parse(w.toStringAsFixed(4))).toList(),
      'num_samples': sampleCount,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    };
  }
}
