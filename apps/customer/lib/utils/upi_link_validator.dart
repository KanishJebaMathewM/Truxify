/// Validates server-supplied UPI deep links before they are handed to the OS
/// via [launchUrl].
///
/// A malicious or compromised backend (or a MITM, given the cleartext-HTTP
/// fallback elsewhere) could return an arbitrary intent — e.g. `tel:`,
/// `sms:`, a phishing `http(s)://`, or a `upi://` link whose payee/amount
/// differ from the order. Only vetted schemes are allowed and, for `upi://`,
/// the payee (`pa`) must be present and the amount (`am`) must match what the
/// app expects for the order.
class UpiLinkValidator {
  const UpiLinkValidator._();

  static const Set<String> _allowedSchemes = {'upi', 'https'};

  /// Platform-controlled UPI redirect hosts. A `https` deep link is only
  /// launched when its host is in this list. An empty list (the default)
  /// rejects every `https` link as unvetted.
  static const List<String> allowedHttpsHosts = <String>[];

  /// Returns `true` only if [link] is safe to launch.
  static bool isSafe(
    String? link, {
    String? expectedAmount,
    List<String> httpsHosts = allowedHttpsHosts,
  }) {
    if (link == null || link.isEmpty) return false;

    final uri = Uri.tryParse(link);
    if (uri == null) return false;

    final scheme = uri.scheme.toLowerCase();
    if (!_allowedSchemes.contains(scheme)) return false;

    if (scheme == 'https') {
      final host = uri.host.toLowerCase();
      if (httpsHosts.isEmpty) return false;
      return httpsHosts.contains(host);
    }

    // scheme == 'upi'
    final pa = uri.queryParameters['pa'];
    if (pa == null || pa.trim().isEmpty) return false;

    final am = uri.queryParameters['am'];
    if (am != null && am.isNotEmpty && expectedAmount != null && expectedAmount.isNotEmpty) {
      final parsedAm = _parseAmount(am);
      final parsedExpected = _parseAmount(expectedAmount);
      if (parsedAm != null && parsedExpected != null && parsedAm != parsedExpected) {
        return false;
      }
    }

    return true;
  }

  static double? _parseAmount(String value) {
    final numeric = value.replaceAll(RegExp(r'[^0-9.]'), '');
    if (numeric.isEmpty) return null;
    return double.tryParse(numeric);
  }
}
