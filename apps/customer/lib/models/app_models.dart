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
    this.pickupDate,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
    this.truckType,
    this.minCapacity,
    this.maxCapacity,
    this.materialType,
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
  final DateTime? pickupDate;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;
  final String? truckType;
  final double? minCapacity;
  final double? maxCapacity;
  final String? materialType;
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
    this.tripCount,
    this.lastUsedDate,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
  });

  final String route;
  final String pickup;
  final String drop;
  final int? tripCount;
  final String? lastUsedDate;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;
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
    this.freeSpacePercent = 0,
    required this.price,
    required this.eta,
    this.badge,
    this.badgeColor = Colors.black,
    this.baseFreight,
    this.tollEstimate,
    this.platformFee,
    this.truckNumber,
    this.isAiEstimate = false,
  });

  factory TruckResultData.fromJson(Map<String, dynamic> json) {
    final rawPrice = json['price'];
    final priceStr = rawPrice is num
        ? '₹${(rawPrice / 100).round()}'
        : (rawPrice?.toString() ?? '₹0');

    final rawBaseFreight = json['baseFreight'];
    final baseFreightStr = rawBaseFreight is num
        ? '₹${(rawBaseFreight / 100).round()}'
        : null;

    final rawTollEstimate = json['tollEstimate'];
    final tollEstimateStr = rawTollEstimate is num
        ? '₹${(rawTollEstimate / 100).round()}'
        : null;

    final rawPlatformFee = json['platformFee'];
    final platformFeeStr = rawPlatformFee is num
        ? '₹${(rawPlatformFee / 100).round()}'
        : null;

    final etaMinutes = json['etaMinutes'];
    final etaStr = etaMinutes != null
        ? (etaMinutes < 60
            ? '${etaMinutes} mins'
            : '${(etaMinutes / 60).toStringAsFixed(1)} hrs')
        : '—';

    return TruckResultData(
      driver: json['driver'] as String? ?? 'Unknown Driver',
      rating: (json['rating'] as num?)?.toDouble() ?? 0.0,
      truck: json['truck'] as String? ?? 'Unknown Truck',
      capacity: json['capacity'] as String? ?? '',
      price: priceStr,
      eta: etaStr,
      badge: json['badge'] as String?,
      baseFreight: baseFreightStr,
      tollEstimate: tollEstimateStr,
      platformFee: platformFeeStr,
      truckNumber: json['truckNumber'] as String? ?? json['number_plate'] as String?,
      isAiEstimate: json['isAiEstimate'] as bool? ?? false,
    );
  }

  final String driver;
  final double rating;
  final String truck;
  final String capacity;
  final int freeSpacePercent;
  final String price;
  final String eta;
  final String? badge;
  final Color badgeColor;
  final String? baseFreight;
  final String? tollEstimate;
  final String? platformFee;
  final String? truckNumber;
  final bool isAiEstimate;
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
    this.blockchainTxHash,
    this.baseFare,
    this.distanceCharge,
    this.tollCharge,
    this.platformFee,
    this.driverPhone,
    this.goodsType,
    this.weightTonnes,
    this.dimensions,
    this.isStackable,
    this.isFragile,
    this.specialRequirements,
  });

  final String orderId;
  final String route;
  final String date;
  final String amount;
  final String status;
  final String driver;
  final String truckNumber;
  final List<TimelineStepData> timeline;
  final String? blockchainTxHash;
  final String? baseFare;
  final String? distanceCharge;
  final String? tollCharge;
  final String? platformFee;
  final String? driverPhone;
  final String? goodsType;
  final String? weightTonnes;
  final String? dimensions;
  final bool? isStackable;
  final bool? isFragile;
  final String? specialRequirements;
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
