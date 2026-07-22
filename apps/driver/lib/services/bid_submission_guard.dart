class BidSubmissionGuard {
  final Set<String> _inFlight = <String>{};

  Future<T> run<T>({
    required String loadId,
    required Future<T> Function() action,
  }) async {
    if (_inFlight.contains(loadId)) {
      throw StateError('Submission already in progress for load $loadId');
    }

    _inFlight.add(loadId);
    try {
      return await action();
    } finally {
      _inFlight.remove(loadId);
    }
  }
}
