/// Shared application-level configuration constants.
class AppConfig {
  static const Duration apiTimeout = Duration(seconds: 10);
  static const Duration geocodeTimeout = Duration(seconds: 6);
  static const Duration routeTimeout = Duration(seconds: 8);
  static const Duration profileUpdateTimeout = Duration(seconds: 10);
  static const Duration quickActionTimeout = Duration(seconds: 5);
  static const Duration syncTimeout = Duration(seconds: 15);
}
