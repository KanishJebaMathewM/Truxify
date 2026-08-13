import 'dart:async';
import '../models/weather_overlay_model.dart';

class WeatherOverlayService {
  final _sessionController = StreamController<WeatherOverlaySession>.broadcast();

  Stream<WeatherOverlaySession> get weatherStream => _sessionController.stream;

  void fetchWeatherPolygons() async {
    _sessionController.add(WeatherOverlaySession(
      status: 'Fetching NWS GeoJSON Polygons...',
      mapRegion: 'Midwest Corridor',
      segments: [],
      totalSafeMiles: 0,
      totalHazardMiles: 0,
    ));

    await Future.delayed(const Duration(seconds: 1));
    
    _sessionController.add(WeatherOverlaySession(
      status: 'Calculating Spatial Intersections...',
      mapRegion: 'Midwest Corridor',
      segments: [],
      totalSafeMiles: 0,
      totalHazardMiles: 0,
    ));

    await Future.delayed(const Duration(seconds: 1));

    _sessionController.add(WeatherOverlaySession(
      status: 'Weather Polygon Rendering Complete',
      mapRegion: 'Midwest Corridor (I-80)',
      segments: [
        RouteSegment(id: 'S-1', startLocation: 'Omaha, NE', endLocation: 'Des Moines, IA', miles: 135, intersectsWeather: false),
        RouteSegment(id: 'S-2', startLocation: 'Des Moines, IA', endLocation: 'Iowa City, IA', miles: 115, intersectsWeather: true, warningType: 'Blizzard Warning Polygon'),
        RouteSegment(id: 'S-3', startLocation: 'Iowa City, IA', endLocation: 'Chicago, IL', miles: 220, intersectsWeather: false),
      ],
      totalSafeMiles: 355,
      totalHazardMiles: 115,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
