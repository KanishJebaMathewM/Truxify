import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../utils/driver_metrics.dart';

const driverName = 'Ramesh Kumar';
const driverInitials = 'RK';
const driverTruck = 'Tata 407';
const driverTruckNumber = 'TN 45 AB 1234';
const driverRating = '4.8';
const driverTrips = '142';
const driverCompletion = '97%';
const driverEarningsMonth = '₹1.2L';
const driverOnlineLabel = 'Online';
const driverOfflineLabel = 'Offline';
const driverPhone = '+91 98765 43210';
const walletConfirmed = '₹2,100';
const walletPending = '₹4,700';
const walletTotal = '₹6,800';
const activeTripId = '#TX20241205';
const activeCurrentStop = 'Stop 2 of 3';
const activeTripConfirmed = '₹2,100';
const activeTripPending = '₹4,700';
const activeTripTotal = '₹6,800';
const onboardingTagline = 'Drive More. Earn More.';
const loginSubtitle = 'Log in to start earning';

final DateTime driverMockNow = DateTime.now();
final int driverMonthlyEarningsInr =
    DriverMetrics.tryParseInrAmount(driverEarningsMonth) ??
        DriverMetrics.monthlyEarningsInrFromHistory(tripHistory, now: driverMockNow);
final String driverMonthlyEarningsLabel =
    DriverMetrics.formatInrCompact(driverMonthlyEarningsInr);
final String driverTimeSinceLastTripLabel =
    DriverMetrics.timeSinceLastTripLabel(tripHistory, now: driverMockNow);

const availableFilterChips = ['All', 'Best Profit', 'Nearest', 'Earliest Pickup'];
const tripHistoryFilters = ['This Week', 'This Month', 'All Time'];

const List<DemandRoute> demandRoutes = [
  DemandRoute(
    route: 'Surat → Mumbai',
    demand: 'Very High Demand',
    estimatedEarnings: '₹4,200–₹5,800',
    note: '🔥',
  ),
  DemandRoute(
    route: 'Vadodara → Pune',
    demand: 'High Demand',
    estimatedEarnings: '₹3,800–₹4,600',
    note: '📈',
  ),
];

const List<RouteMapPoint> activeRouteMapPoints = [
  RouteMapPoint(
    id: 'surat-yard',
    title: 'Surat Yard',
    subtitle: 'Pickup point',
    details: 'Load already claimed and confirmed for dispatch from Surat.',
    progress: 0.08,
    claimed: true,
    icon: Icons.storefront_rounded,
    latitude: 21.1702,
    longitude: 72.8311,
    loadOfferId: 'load-surat-jaipur',
  ),
  RouteMapPoint(
    id: 'vadodara-toll',
    title: 'Vadodara Toll',
    subtitle: 'Checkpoint',
    details: 'Unclaimed road checkpoint on the corridor. Tap to claim if you are covering it.',
    progress: 0.34,
    claimed: false,
    icon: Icons.toll_rounded,
    latitude: 22.3072,
    longitude: 73.1812,
    loadOfferId: 'load-vadodara-mumbai',
  ),
  RouteMapPoint(
    id: 'nh48-fuel',
    title: 'NH48 Fuel Stop',
    subtitle: 'Refuel point',
    details: 'Claimed fuel stop with parking and quick refreshment access.',
    progress: 0.58,
    claimed: true,
    icon: Icons.local_gas_station_rounded,
    latitude: 23.0265,
    longitude: 72.5873,
    loadOfferId: 'load-ahmedabad-pune',
  ),
  RouteMapPoint(
    id: 'jaipur-drop',
    title: 'Jaipur Drop',
    subtitle: 'Destination',
    details: 'Final drop location. This remains unclaimed until the truck reaches Jaipur.',
    progress: 0.94,
    claimed: false,
    icon: Icons.location_on_rounded,
    latitude: 26.9124,
    longitude: 75.7873,
    loadOfferId: 'load-mumbai-delhi',
  ),
];

const List<LoadOffer> availableLoads = [
  LoadOffer(
    id: 'load-surat-jaipur',
    route: 'Surat → Jaipur',
    routeSubtitle: 'Best Profit',
    customer: 'Karthik Murugan',
    company: 'Sri Murugan Textiles',
    goods: 'Textile',
    pickup: 'Tomorrow 6:00 AM',
    distanceFromDriver: '2.4 km',
    estimatedProfit: '₹5,200',
    fuelCost: '₹1,200',
    tollCost: '₹380',
    capacityUsed: 0.60,
    truckFillLabel: '60% capacity used',
    sharingTruckWith: '1 other customer',
    badgeLabel: 'Best Profit',
    badgeEmoji: '🏆',
    routeDistance: '612 km',
    routeDuration: '9.5 hours',
    weight: '3 tonnes',
    dimensions: '12 × 6 × 6 ft',
    stackable: 'Yes',
    fragile: 'No',
    specialHandling: 'Temperature control',
    freightValue: '₹6,800',
    netProfit: '₹5,200',
    routeNote: 'Loads cleanly into your current route profile.',
    extraDistance: 0,
    extraEarnings: '₹0',
    spaceAvailable: '40% remaining',
    updatedTotalEarnings: '₹5,200',
    bestProfit: true,
  ),
  LoadOffer(
    id: 'load-mumbai-delhi',
    route: 'Mumbai → Delhi',
    routeSubtitle: 'High Volume',
    customer: 'Raj Textiles',
    company: 'Raj Textile Solutions',
    goods: 'Electronics',
    pickup: 'Tomorrow 8:00 AM',
    distanceFromDriver: '5.1 km',
    estimatedProfit: '₹8,400',
    fuelCost: '₹2,100',
    tollCost: '₹680',
    capacityUsed: 0.80,
    truckFillLabel: '80% capacity used',
    sharingTruckWith: '2 other customers',
    badgeLabel: 'High Profit',
    badgeEmoji: '⚡',
    routeDistance: '1,430 km',
    routeDuration: '17.8 hours',
    weight: '5 tonnes',
    dimensions: '14 × 7 × 7 ft',
    stackable: 'Partial',
    fragile: 'Yes',
    specialHandling: 'Shock resistant packing',
    freightValue: '₹11,180',
    netProfit: '₹8,400',
    routeNote: 'Balanced payout for a longer line haul.',
    extraDistance: 0,
    extraEarnings: '₹0',
    spaceAvailable: '20% remaining',
    updatedTotalEarnings: '₹8,400',
  ),
  LoadOffer(
    id: 'load-ahmedabad-pune',
    route: 'Ahmedabad → Pune',
    routeSubtitle: 'Nearest Pickup',
    customer: 'Sri Textiles',
    company: 'Sri Textiles Co.',
    goods: 'Furniture',
    pickup: 'Today 3:00 PM',
    distanceFromDriver: '1.8 km',
    estimatedProfit: '₹4,800',
    fuelCost: '₹980',
    tollCost: '₹320',
    capacityUsed: 0.50,
    truckFillLabel: '50% capacity used',
    sharingTruckWith: 'Only customer',
    badgeLabel: 'Fast Pickup',
    badgeEmoji: '📍',
    routeDistance: '546 km',
    routeDuration: '8.2 hours',
    weight: '4 tonnes',
    dimensions: '10 × 5 × 5 ft',
    stackable: 'Yes',
    fragile: 'No',
    specialHandling: 'Keep dry',
    freightValue: '₹6,100',
    netProfit: '₹4,800',
    routeNote: 'Direct pickup with minimal idle time.',
    extraDistance: 0,
    extraEarnings: '₹0',
    spaceAvailable: '50% remaining',
    updatedTotalEarnings: '₹4,800',
  ),
  LoadOffer(
    id: 'load-vadodara-mumbai',
    route: 'Vadodara → Mumbai',
    routeSubtitle: 'High Fill',
    customer: 'Krishna Exports',
    company: 'Krishna Export Logistics',
    goods: 'Machinery',
    pickup: 'Tomorrow 5:00 AM',
    distanceFromDriver: '8.3 km',
    estimatedProfit: '₹6,100',
    fuelCost: '₹1,600',
    tollCost: '₹520',
    capacityUsed: 0.90,
    truckFillLabel: '90% capacity used',
    sharingTruckWith: '1 other customer',
    badgeLabel: 'Near Full',
    badgeEmoji: '✅',
    routeDistance: '431 km',
    routeDuration: '7.1 hours',
    weight: '6 tonnes',
    dimensions: '13 × 6 × 6 ft',
    stackable: 'No',
    fragile: 'Yes',
    specialHandling: 'Lift with fork truck',
    freightValue: '₹8,220',
    netProfit: '₹6,100',
    routeNote: 'High utilization with strong margin.',
    extraDistance: 0,
    extraEarnings: '₹0',
    spaceAvailable: '10% remaining',
    updatedTotalEarnings: '₹6,100',
  ),
];

const List<LoadOffer> enRouteLoads = [
  LoadOffer(
    route: 'Vadodara → Jaipur',
    routeSubtitle: 'On your route',
    customer: 'Mehta Traders',
    company: 'Mehta Freight',
    goods: 'Textile',
    pickup: 'Vadodara — 12 km from your route',
    distanceFromDriver: '12 km',
    estimatedProfit: '₹2,100',
    fuelCost: '₹0',
    tollCost: '₹0',
    capacityUsed: 0.35,
    truckFillLabel: '35% remaining in your truck',
    sharingTruckWith: 'Return load opportunity',
    badgeLabel: 'On Route',
    badgeEmoji: '🛣️',
    routeDistance: '132 km',
    routeDuration: '2.4 hours',
    weight: '1.5 tonnes',
    dimensions: '8 × 4 × 4 ft',
    stackable: 'Yes',
    fragile: 'No',
    specialHandling: 'Route match',
    freightValue: '₹2,100',
    netProfit: '₹2,100',
    routeNote: 'Matches your Jaipur run closely.',
    extraDistance: 12,
    extraEarnings: '₹2,100',
    spaceAvailable: '35% remaining in your truck',
    updatedTotalEarnings: '₹8,200',
  ),
  LoadOffer(
    route: 'Ratlam → Jaipur',
    routeSubtitle: 'Slight detour',
    customer: 'Sharma Exports',
    company: 'Sharma Export House',
    goods: 'Packaging',
    pickup: 'Ratlam — 28 km off your route',
    distanceFromDriver: '28 km',
    estimatedProfit: '₹1,400',
    fuelCost: '₹0',
    tollCost: '₹0',
    capacityUsed: 0.35,
    truckFillLabel: '35% remaining in your truck',
    sharingTruckWith: 'Return load opportunity',
    badgeLabel: 'Small Detour',
    badgeEmoji: '➕',
    routeDistance: '98 km',
    routeDuration: '1.8 hours',
    weight: '1 tonne',
    dimensions: '6 × 4 × 4 ft',
    stackable: 'Yes',
    fragile: 'No',
    specialHandling: 'Route check before pickup',
    freightValue: '₹1,400',
    netProfit: '₹1,400',
    routeNote: 'Best if you want a quick extra top-up.',
    extraDistance: 28,
    extraEarnings: '₹1,400',
    spaceAvailable: '35% remaining in your truck',
    updatedTotalEarnings: '₹8,200',
  ),
];

const List<TripStop> activeTripStops = [
  TripStop(
    customer: 'Karthik Murugan',
    route: 'Surat → Vadodara',
    goods: 'Textile, 3 tonnes',
    statusLabel: 'Delivered ✅',
    earningsLabel: '₹2,100 released',
    tripPath: 'Delivered',
    dropLocation: 'Vadodara',
    tonnes: '3 tonnes',
    isCurrent: false,
    isCompleted: true,
  ),
  TripStop(
    customer: 'Raj Textiles',
    route: 'Vadodara → Jaipur',
    goods: 'Electronics, 2 tonnes',
    statusLabel: 'In Progress 🔄',
    earningsLabel: '₹2,800 pending',
    tripPath: 'Current',
    dropLocation: 'Jaipur, Rajasthan',
    tonnes: '2 tonnes',
    isCurrent: true,
    isCompleted: false,
  ),
  TripStop(
    customer: 'Sharma Exports',
    route: 'Jaipur → Ajmer',
    goods: 'Packaging, 1 tonne',
    statusLabel: 'Pending ⏳',
    earningsLabel: '₹1,900 pending',
    tripPath: 'Pending',
    dropLocation: 'Ajmer',
    tonnes: '1 tonne',
    isCurrent: false,
    isCompleted: false,
  ),
];

const List<TripRecord> tripHistory = [
  TripRecord(
    route: 'Surat → Jaipur',
    date: '14 May 2026',
    earnings: '₹5,200',
    statusLabel: 'Completed',
    tripId: '#TX20260514',
    hash: '0x3a574d5...8f2c',
    verifiedBadge: 'Verified on Polygon',
    completed: true,
  ),
  TripRecord(
    route: 'Mumbai → Delhi',
    date: '11 May 2026',
    earnings: '₹8,400',
    statusLabel: 'Completed',
    tripId: '#TX20260511',
    hash: '0x5b2b1e3...6ad1',
    verifiedBadge: 'Verified on Polygon',
    completed: true,
  ),
  TripRecord(
    route: 'Ahmedabad → Pune',
    date: '7 May 2026',
    earnings: '₹4,800',
    statusLabel: 'Completed',
    tripId: '#TX20260507',
    hash: '0x9cf11a4...1b39',
    verifiedBadge: 'Verified on Polygon',
    completed: true,
  ),
  TripRecord(
    route: 'Vadodara → Mumbai',
    date: '2 May 2026',
    earnings: '₹3,200',
    statusLabel: 'Cancelled',
    tripId: '#TX20260502',
    hash: '0x1aa63bc...c901',
    verifiedBadge: 'Verified on Polygon',
    completed: false,
  ),
];

const List<DocumentRecord> documentRecords = [
  DocumentRecord(
    title: 'RC Book',
    subtitle: 'Truck: TN 45 AB 1234',
    statusLabel: 'Verified via Digilocker ✅',
    statusTone: 'verified',
    docNumber: 'TN-45-AB-1234',
    lastVerified: '1 Jan 2024',
    validUntil: '2034',
  ),
  DocumentRecord(
    title: 'Driving Licence',
    subtitle: 'Licence No: TN1234567890',
    statusLabel: 'Verified via Digilocker ✅',
    statusTone: 'verified',
    docNumber: 'TN1234567890',
    lastVerified: '1 Jan 2024',
    validUntil: '2030',
  ),
  DocumentRecord(
    title: 'Insurance',
    subtitle: 'Policy: HDFC ERGO',
    statusLabel: 'Expiring Soon ⚠️',
    statusTone: 'warning',
    docNumber: 'HDFC-ERGO-12345',
    lastVerified: '1 Jan 2024',
    validUntil: 'Dec 2025',
    ctaLabel: 'Renew Insurance',
  ),
];

/// Lookup map: loadOfferId → LoadOffer.
/// Used by [LoadPointDetailScreen] to resolve a map point to its full load data.
final Map<String, LoadOffer> loadOfferById = {
  for (final load in [...availableLoads, ...enRouteLoads])
    if (load.id.isNotEmpty) load.id: load,
};

// ──────────────────────────────────────────────────
// Trips screen mock data
// ──────────────────────────────────────────────────

const List<Trip> mockTrips = [
  Trip(
    route: 'Surat → Jaipur',
    date: 'Today · 6:00 AM',
    items: ['Textile 3t', 'Electronics 2t'],
    itemCount: '2 items · 612 km',
    distance: '612 km',
    earnings: '₹6,800',
    status: TripStatusType.active,
    tripId: '#TX20241205',
    hash: '0x3a574d5c8f2c...31128',
    duration: '9h 45m',
    endTime: '3:45 PM',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹6,200',
      fuelDeducted: '-₹980',
      tollDeducted: '-₹380',
      platformFee: '-₹0',
      netEarnings: '₹5,200',
    ),
    tripItems: [
      TripItem(
        customerName: 'Karthik Murugan',
        goods: 'Textile 3t',
        destination: 'Jaipur',
        earnings: '₹3,800',
        delivered: true,
      ),
      TripItem(
        customerName: 'Raj Textiles',
        goods: 'Electronics 2t',
        destination: 'Jaipur',
        earnings: '₹3,000',
        delivered: true,
      ),
    ],
  ),
  Trip(
    route: 'Mumbai → Delhi',
    date: '25 Nov 2024 · 8:00 AM',
    items: ['Machinery 5t'],
    itemCount: '1 item · 1,400 km',
    distance: '1,400 km',
    earnings: '₹8,400',
    status: TripStatusType.completed,
    tripId: '#TX20241125',
    hash: '0x5b2b1e3a7d...6ad1',
    duration: '18h 30m',
    endTime: '2:30 AM',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹11,180',
      fuelDeducted: '-₹2,100',
      tollDeducted: '-₹680',
      platformFee: '-₹0',
      netEarnings: '₹8,400',
    ),
    tripItems: [
      TripItem(
        customerName: 'Krishna Exports',
        goods: 'Machinery 5t',
        destination: 'Delhi',
        earnings: '₹8,400',
        delivered: true,
      ),
    ],
  ),
  Trip(
    route: 'Ahmedabad → Pune',
    date: '20 Nov 2024 · 5:30 AM',
    items: ['Furniture 4t', 'Packaging 1t'],
    itemCount: '2 items · 530 km',
    distance: '530 km',
    earnings: '₹4,800',
    status: TripStatusType.completed,
    tripId: '#TX20241120',
    hash: '0x9cf11a4b5e...1b39',
    duration: '8h 15m',
    endTime: '1:45 PM',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹6,100',
      fuelDeducted: '-₹980',
      tollDeducted: '-₹320',
      platformFee: '-₹0',
      netEarnings: '₹4,800',
    ),
    tripItems: [
      TripItem(
        customerName: 'Sri Textiles',
        goods: 'Furniture 4t',
        destination: 'Pune',
        earnings: '₹3,400',
        delivered: true,
      ),
      TripItem(
        customerName: 'Sharma Exports',
        goods: 'Packaging 1t',
        destination: 'Pune',
        earnings: '₹1,400',
        delivered: true,
      ),
    ],
  ),
  Trip(
    route: 'Vadodara → Mumbai',
    date: '15 Nov 2024 · 7:00 AM',
    items: ['Textile 2t'],
    itemCount: '1 item · 430 km',
    distance: '430 km',
    earnings: '₹3,200',
    status: TripStatusType.completed,
    tripId: '#TX20241115',
    hash: '0x1aa63bce90...c901',
    duration: '7h 10m',
    endTime: '2:10 PM',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹4,600',
      fuelDeducted: '-₹900',
      tollDeducted: '-₹500',
      platformFee: '-₹0',
      netEarnings: '₹3,200',
    ),
    tripItems: [
      TripItem(
        customerName: 'Mehta Traders',
        goods: 'Textile 2t',
        destination: 'Mumbai',
        earnings: '₹3,200',
        delivered: true,
      ),
    ],
  ),
  Trip(
    route: 'Surat → Hyderabad',
    date: '10 Nov 2024 · 9:00 AM',
    items: [],
    itemCount: 'Cancelled before pickup',
    distance: '—',
    earnings: '₹0',
    status: TripStatusType.cancelled,
    tripId: '#TX20241110',
    hash: '0x0000000000...0000',
    duration: '—',
    endTime: '—',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹0',
      fuelDeducted: '₹0',
      tollDeducted: '₹0',
      platformFee: '₹0',
      netEarnings: '₹0',
    ),
    tripItems: [],
  ),
];

// ──────────────────────────────────────────────────
// Earnings screen mock data
// ──────────────────────────────────────────────────

const List<EarningDay> weeklyEarnings = [
  EarningDay(day: 'Mon', amount: 1200, tripCount: 1),
  EarningDay(day: 'Tue', amount: 3400, tripCount: 2),
  EarningDay(day: 'Wed', amount: 2100, tripCount: 1),
  EarningDay(day: 'Thu', amount: 4200, tripCount: 3),
  EarningDay(day: 'Fri', amount: 3800, tripCount: 2),
  EarningDay(day: 'Sat', amount: 2400, tripCount: 1),
  EarningDay(day: 'Sun', amount: 1300, tripCount: 1),
];

const List<PendingPayment> pendingPayments = [
  PendingPayment(
    customerName: 'Raj Textiles',
    route: 'Surat → Jaipur',
    amount: '₹2,800',
    note: 'Releasing on delivery',
  ),
  PendingPayment(
    customerName: 'Sharma Exports',
    route: 'Jaipur → Ajmer',
    amount: '₹1,900',
    note: 'Releasing on delivery',
  ),
];

