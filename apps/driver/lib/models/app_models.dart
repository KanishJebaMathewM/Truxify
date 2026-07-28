import 'package:flutter/material.dart';

enum LoadsSection { available, enRoute }

enum TripStatus { delivered, inProgress, pending, cancelled }

enum DocumentState { verified, expiringSoon }

class RouteMapPoint {
  const RouteMapPoint({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.details,
    required this.progress,
    required this.claimed,
    required this.icon,
    required this.latitude,
    required this.longitude,
    this.loadOfferId,
  });

  final String id;
  final String title;
  final String subtitle;
  final String details;
  final double progress;
  final bool claimed;
  final IconData icon;
  final double latitude;
  final double longitude;

  /// If non-null, this map point is linked to a [LoadOffer] with this id.
  /// Tapping it should open the full load detail screen.
  final String? loadOfferId;

  bool get hasLoad => loadOfferId != null;

  RouteMapPoint copyWith({
    String? id,
    String? title,
    String? subtitle,
    String? details,
    double? progress,
    bool? claimed,
    IconData? icon,
    double? latitude,
    double? longitude,
    String? loadOfferId,
  }) {
    return RouteMapPoint(
      id: id ?? this.id,
      title: title ?? this.title,
      subtitle: subtitle ?? this.subtitle,
      details: details ?? this.details,
      progress: progress ?? this.progress,
      claimed: claimed ?? this.claimed,
      icon: icon ?? this.icon,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      loadOfferId: loadOfferId ?? this.loadOfferId,
    );
  }
}

class RouteMapPlan {
  const RouteMapPlan({
    required this.routeLabel,
    required this.destinationLabel,
    required this.points,
  });

  final String routeLabel;
  final String destinationLabel;
  final List<RouteMapPoint> points;
}

class RouteMapScreenArgs {
  const RouteMapScreenArgs({
    required this.routeLabel,
    required this.destinationLabel,
    required this.points,
  });

  final String routeLabel;
  final String destinationLabel;
  final List<RouteMapPoint> points;
}

class LoadOffer {
  const LoadOffer({
    required this.route,
    required this.customer,
    required this.company,
    required this.goods,
    required this.pickup,
    required this.distanceFromDriver,
    required this.estimatedProfit,
    required this.fuelCost,
    required this.tollCost,
    required this.capacityUsed,
    required this.truckFillLabel,
    required this.sharingTruckWith,
    required this.badgeLabel,
    required this.badgeEmoji,
    required this.routeDistance,
    required this.routeDuration,
    required this.weight,
    required this.dimensions,
    required this.stackable,
    required this.fragile,
    required this.specialHandling,
    required this.freightValue,
    required this.netProfit,
    required this.routeNote,
    required this.extraDistance,
    required this.extraEarnings,
    required this.spaceAvailable,
    required this.updatedTotalEarnings,
    this.bestProfit = false,
    this.routeSubtitle = '',
    this.id = '',
    this.originLat,
    this.originLng,
    this.destinationLat,
    this.destinationLng,
    this.weightKg,
    this.lengthM,
    this.widthM,
    this.heightM,
    this.paymentInr,
  });

  final String id;
  final String route;
  final String routeSubtitle;
  final String customer;
  final String company;
  final String goods;
  final String pickup;
  final String distanceFromDriver;
  final String estimatedProfit;
  final String fuelCost;
  final String tollCost;
  final double capacityUsed;
  final String truckFillLabel;
  final String sharingTruckWith;
  final String badgeLabel;
  final String badgeEmoji;
  final bool bestProfit;
  final String routeDistance;
  final String routeDuration;
  final String weight;
  final String dimensions;
  final String stackable;
  final String fragile;
  final String specialHandling;
  final String freightValue;
  final String netProfit;
  final String routeNote;
  final int extraDistance;
  final String extraEarnings;
  final String spaceAvailable;
  final String updatedTotalEarnings;

  /// Raw coordinate and cargo data for ML recommendation payloads.
  /// These are nullable for backward compatibility with mock data
  /// and older API responses.
  final double? originLat;
  final double? originLng;
  final double? destinationLat;
  final double? destinationLng;
  final double? weightKg;
  final double? lengthM;
  final double? widthM;
  final double? heightM;
  final double? paymentInr;

  /// Whether this load has sufficient raw data for deadhead recommendations.
  bool get hasDeadheadData =>
      originLat != null &&
      originLng != null &&
      destinationLat != null &&
      destinationLng != null &&
      weightKg != null &&
      paymentInr != null;
}

class DemandRoute {
  const DemandRoute({
    required this.route,
    required this.demand,
    required this.estimatedEarnings,
    required this.note,
  });

  final String route;
  final String demand;
  final String estimatedEarnings;
  final String note;
}

class TripStop {
  const TripStop({
    required this.customer,
    required this.route,
    required this.goods,
    required this.statusLabel,
    required this.earningsLabel,
    required this.tripPath,
    required this.dropLocation,
    required this.tonnes,
    required this.isCurrent,
    required this.isCompleted,
  });

  final String customer;
  final String route;
  final String goods;
  final String statusLabel;
  final String earningsLabel;
  final String tripPath;
  final String dropLocation;
  final String tonnes;
  final bool isCurrent;
  final bool isCompleted;
}

class TripRecord {
  const TripRecord({
    required this.route,
    required this.date,
    required this.earnings,
    required this.statusLabel,
    required this.tripId,
    required this.hash,
    required this.verifiedBadge,
    required this.completed,
  });

  final String route;
  final String date;
  final String earnings;
  final String statusLabel;
  final String tripId;
  final String hash;
  final String verifiedBadge;
  final bool completed;
}

class DocumentRecord {
  const DocumentRecord({
    required this.title,
    required this.subtitle,
    required this.statusLabel,
    required this.statusTone,
    required this.docNumber,
    required this.lastVerified,
    required this.validUntil,
    this.ctaLabel = 'View Document',
  });

  final String title;
  final String subtitle;
  final String statusLabel;
  final String statusTone;
  final String docNumber;
  final String lastVerified;
  final String validUntil;
  final String ctaLabel;
}

// ──────────────────────────────────────────────────
// Trips & Earnings models
// ──────────────────────────────────────────────────

enum TripStatusType { active, completed, cancelled }

class Trip {
  const Trip({
    required this.route,
    required this.date,
    required this.items,
    required this.itemCount,
    required this.distance,
    required this.earnings,
    required this.status,
    required this.tripId,
    required this.hash,
    this.duration = '',
    this.endTime = '',
    this.paymentBreakdown,
    this.tripItems = const [],
  });

  final String route;
  final String date;
  final List<String> items; // e.g. ["Textile 3t", "Electronics 2t"]
  final String itemCount; // e.g. "2 items · 612 km"
  final String distance;
  final String earnings;
  final TripStatusType status;
  final String tripId;
  final String hash;
  final String duration;
  final String endTime;
  final PaymentBreakdown? paymentBreakdown;
  final List<TripItem> tripItems;
}

class TripItem {
  const TripItem({
    required this.customerName,
    required this.goods,
    required this.destination,
    required this.earnings,
    required this.delivered,
    required this.isFragile = false,
    required this.isStackable = true,
    this.specialRequirements,
  });

  final String customerName;
  final String goods;
  final String destination;
  final String earnings;
  final bool delivered;
  final bool isFragile;
  final bool isStackable;
  final String? specialRequirements;
}

class PaymentBreakdown {
  const PaymentBreakdown({
    required this.baseFreight,
    required this.fuelDeducted,
    required this.tollDeducted,
    required this.platformFee,
    required this.netEarnings,
  });

  final String baseFreight;
  final String fuelDeducted;
  final String tollDeducted;
  final String platformFee;
  final String netEarnings;
}

class EarningDay {
  const EarningDay({
    required this.day,
    required this.amount,
    required this.tripCount,
  });

  final String day;
  final int amount;
  final int tripCount;
}

class Milestone {
  const Milestone({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.achieved,
    this.progress,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final bool achieved;
  final double? progress; // 0.0-1.0, null if achieved
}

class PendingPayment {
  const PendingPayment({
    required this.customerName,
    required this.route,
    required this.amount,
    required this.note,
  });

  final String customerName;
  final String route;
  final String amount;
  final String note;
}

class EarningsBreakdownRow {
  const EarningsBreakdownRow({
    required this.label,
    required this.amount,
    required this.percentage,
    required this.color,
  });

  final String label;
  final String amount;
  final double percentage;
  final Color color;
}
