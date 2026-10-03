Future<void> _authenticateWithBiometrics() async {
  try {
    final authenticated = await _localAuth.authenticate(
      localizedReason: 'Authenticate to log in',
      options: const AuthenticationOptions(
        stickyAuth: true,
        biometricOnly: true,
      ),
    );

    if (!authenticated || !mounted) return;

    // Restore the existing Firebase authentication session.
    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No saved login session found. Please log in using OTP.',
          ),
        ),
      );
      return;
    }

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          AppLocalizations.of(context)!.biometricAuthSuccessful,
        ),
      ),
    );

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => const TruxifyShellScreen(),
      ),
    );
  } catch (e) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Biometric login failed. Please log in using OTP.',
        ),
      ),
    );
  }
}
