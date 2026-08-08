import 'dart:async';
import '../models/ev_charging_station_model.dart';

class EvChargingNetworkService {
  Future<List<EvChargingStation>> getStationsOnRoute() async {
    // Simulate API call to charging network
    await Future.delayed(const Duration(seconds: 1));

    return [
      EvChargingStation(
        stationId: 'CS-001',
        stationName: 'WattEV Commercial Plaza - Barstow',
        distanceMiles: 45.2,
        totalMegawattBays: 8,
        availableBays: 2,
        kwPrice: 0.18,
        isClass8Compatible: true,
        estimatedWaitTime: '0 min',
      ),
      EvChargingStation(
        stationId: 'CS-002',
        stationName: 'Tesla Megacharger - Baker',
        distanceMiles: 92.5,
        totalMegawattBays: 4,
        availableBays: 0,
        kwPrice: 0.22,
        isClass8Compatible: true,
        estimatedWaitTime: '45 min',
      ),
      EvChargingStation(
        stationId: 'CS-003',
        stationName: 'Electrify America - Primm',
        distanceMiles: 130.1,
        totalMegawattBays: 12,
        availableBays: 5,
        kwPrice: 0.15,
        isClass8Compatible: false, // Too small for semis
        estimatedWaitTime: '0 min',
      )
    ];
  }

  Future<EvReservation> reserveBay(EvChargingStation station, DateTime time) async {
    // Simulate reserving a bay
    await Future.delayed(const Duration(seconds: 2));

    return EvReservation(
      reservationId: 'RES-${DateTime.now().millisecondsSinceEpoch.toString().substring(8)}',
      station: station,
      reservedTime: time,
      status: 'Confirmed',
    );
  }
}
