import 'package:flutter/material.dart';

class RouteDraft {
  const RouteDraft({
    required this.pickup,
    required this.drop,
    required this.dateLabel,
    required this.goodsType,
    required this.weightTonnes,
    required this.dimensions,
    required this.stacked,
    required this.fragile,
    required this.requirements,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
  });

  final String pickup;
  final String drop;
  final String dateLabel;
  final String goodsType;
  final String weightTonnes;
  final String dimensions;
  final bool stacked;
  final bool fragile;
  final List<String> requirements;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;
}

class ShipmentCardData {
  const ShipmentCardData({
    required this.route,
    required this.driver,
    required this.truckNumber,
    required this.status,
    required this.statusColor,
    required this.eta,
    required this.isLive,
  });

  final String route;
  final String driver;
  final String truckNumber;
  final String status;
  final Color statusColor;
  final String eta;
  final bool isLive;
}

class RouteCardData {
  const RouteCardData({
    required this.route,
    required this.pickup,
    required this.drop,
  });

  final String route;
  final String pickup;
  final String drop;
}

class StatCardData {
  const StatCardData({
    required this.title,
    required this.value,
    required this.icon,
  });

  final String title;
  final String value;
  final IconData icon;
}

class TruckResultData {
  const TruckResultData({
    required this.driver,
    required this.rating,
    required this.truck,
    required this.capacity,
    required this.freeSpacePercent,
    required this.price,
    required this.eta,
    this.badge,
    this.badgeColor = Colors.black,
  });

  final String driver;
  final double rating;
  final String truck;
  final String capacity;
  final int freeSpacePercent;
  final String price;
  final String eta;
  final String? badge;
  final Color badgeColor;
}

class ActiveOrderData {
  const ActiveOrderData({
    required this.orderId,
    required this.route,
    required this.driver,
    required this.milestone,
    required this.eta,
    required this.status,
  });

  final String orderId;
  final String route;
  final String driver;
  final String milestone;
  final String eta;
  final String status;
}

class HistoryOrderData {
  const HistoryOrderData({
    required this.orderId,
    required this.route,
    required this.date,
    required this.amount,
    required this.status,
    required this.driver,
    required this.truckNumber,
    required this.timeline,
  });

  final String orderId;
  final String route;
  final String date;
  final String amount;
  final String status;
  final String driver;
  final String truckNumber;
  final List<TimelineStepData> timeline;
}

class TimelineStepData {
  const TimelineStepData({
    required this.title,
    required this.timestamp,
    required this.completed,
  });

  final String title;
  final String timestamp;
  final bool completed;
}

class PriceLineData {
  const PriceLineData({
    required this.label,
    required this.amount,
    this.isTotal = false,
  });

  final String label;
  final String amount;
  final bool isTotal;
}

class ProfileMenuData {
  const ProfileMenuData({
    required this.icon,
    required this.title,
    this.subtitle,
    this.isDanger = false,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool isDanger;
}

class LiveTruckTabData {
  const LiveTruckTabData({
    required this.label,
    required this.driver,
    required this.truckNumber,
    required this.rating,
    required this.eta,
    required this.location,
  });

  final String label;
  final String driver;
  final String truckNumber;
  final double rating;
  final String eta;
  final String location;
}
