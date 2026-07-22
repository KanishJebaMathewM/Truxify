class AppRoutes {
  static const splash = '/';
  static const login = '/login';
  static const otp = '/otp';
  static const shell = '/shell';
  static const loadDetail = '/load-detail';
  static const loadPointDetail = '/load-point-detail';
  static const destinationPicker = '/destination-picker';
  static const documents = '/documents';
  static const myTruck = '/my-truck';
  static const earnings = '/earnings';
  static const tripDetail = '/trip-detail';
  static const weightCalculator = '/weight-calculator';
}

class RouteParams {
  final String name;
  final bool requiresAuth;
  const RouteParams(this.name, {this.requiresAuth = true});

  static const splash = RouteParams('/splash', requiresAuth: false);
  static const login = RouteParams('/login', requiresAuth: false);
  static const home = RouteParams('/home');
  static const earnings = RouteParams('/earnings');
  static const trips = RouteParams('/trips');
  static const profile = RouteParams('/profile');
  static const truckDetail = RouteParams('/truck-detail');
  static const loadBoard = RouteParams('/load-board');

  static final List<RouteParams> all = [splash, login, home, earnings, trips, profile, truckDetail, loadBoard];

  static RouteParams fromName(String n) => all.firstWhere((r) => r.name == n, orElse: () => home);
}
