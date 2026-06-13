import 'package:flutter/material.dart';

import '../models/app_models.dart';

const mockOtp = '1234';
const mockPhoneNumber = '+91 98765 43210';
const mockCustomerName = 'Karthik Murugan';

const mockDefaultRouteDraft = RouteDraft(
  pickup: 'Surat, Gujarat',
  drop: 'Jaipur, Rajasthan',
  dateLabel: 'Tomorrow, 6:00 AM',
  goodsType: 'Textile',
  weightTonnes: '3',
  dimensions: '12 × 6 × 6',
  stacked: true,
  fragile: false,
  requirements: <String>['Temperature control', 'Loading help needed'],
  pickupLat: 21.1702,
  pickupLng: 72.8311,
  dropLat: 26.9124,
  dropLng: 75.7873,
);

const mockActiveShipments = <ShipmentCardData>[
  ShipmentCardData(
    route: 'Surat → Jaipur',
    driver: 'Ramesh Kumar | TN 45 AB 1234',
    truckNumber: 'TN 45 AB 1234',
    status: 'In Transit',
    statusColor: Color(0xFF00897B),
    eta: 'Today 4:30 PM',
    isLive: true,
  ),
  ShipmentCardData(
    route: 'Mumbai → Delhi',
    driver: 'Suresh Patel | MH 12 CD 5678',
    truckNumber: 'MH 12 CD 5678',
    status: 'Picked Up',
    statusColor: Color(0xFFFFB300),
    eta: 'Tomorrow 9:00 AM',
    isLive: false,
  ),
];

const mockQuickStats = <StatCardData>[
  StatCardData(title: 'Active', value: '2', icon: Icons.local_shipping_rounded),
  StatCardData(title: 'This month', value: '12 orders', icon: Icons.inventory_2_rounded),
  StatCardData(title: 'Saved vs broker', value: '₹14,200', icon: Icons.savings_rounded),
];

const mockRecentRoutes = <RouteCardData>[
  RouteCardData(route: 'Surat → Jaipur', pickup: 'Surat, Gujarat', drop: 'Jaipur, Rajasthan'),
  RouteCardData(route: 'Mumbai → Delhi', pickup: 'Mumbai, Maharashtra', drop: 'Delhi, NCR'),
  RouteCardData(route: 'Ahmedabad → Pune', pickup: 'Ahmedabad, Gujarat', drop: 'Pune, Maharashtra'),
];

const mockTruckResults = <TruckResultData>[
  TruckResultData(
    driver: 'Ramesh Kumar',
    rating: 4.8,
    truck: 'Tata 407',
    capacity: '3 tonnes capacity',
    freeSpacePercent: 60,
    price: '₹6,800',
    eta: '45 mins',
    badge: 'Best Match',
    badgeColor: Color(0xFF00897B),
  ),
  TruckResultData(
    driver: 'Suresh Patel',
    rating: 4.5,
    truck: 'Ashok Leyland',
    capacity: '5 tonnes',
    freeSpacePercent: 40,
    price: '₹6,200',
    eta: '1.2 hrs',
    badge: 'Cheapest',
    badgeColor: Color(0xFF00695C),
  ),
  TruckResultData(
    driver: 'Mohan Singh',
    rating: 4.9,
    truck: 'Mahindra Bolero',
    capacity: '2 tonnes',
    freeSpacePercent: 80,
    price: '₹7,400',
    eta: '20 mins',
    badge: 'Fastest',
    badgeColor: Color(0xFFFF6B00),
  ),
  TruckResultData(
    driver: 'Vijay Sharma',
    rating: 4.7,
    truck: 'Tata 709',
    capacity: '7 tonnes',
    freeSpacePercent: 55,
    price: '₹7,800',
    eta: '1.5 hrs',
  ),
];

const mockActiveOrders = <ActiveOrderData>[
  ActiveOrderData(
    orderId: '#FF20241205',
    route: 'Surat → Jaipur',
    driver: 'Ramesh Kumar',
    milestone: 'In Transit',
    eta: 'Today 4:30 PM',
    status: 'Active',
  ),
  ActiveOrderData(
    orderId: '#FF20241198',
    route: 'Mumbai → Delhi',
    driver: 'Suresh Patel',
    milestone: 'Picked Up',
    eta: 'Tomorrow 9:00 AM',
    status: 'Active',
  ),
];

final mockHistoryOrders = <HistoryOrderData>[
  HistoryOrderData(
    orderId: '#FF20241188',
    route: 'Surat → Pune',
    date: '28 Nov 2024',
    amount: '₹4,200',
    status: 'Delivered',
    driver: 'Ramesh Kumar',
    truckNumber: 'TN 45 AB 1234',
    timeline: const [
      TimelineStepData(title: 'Order Placed', timestamp: '27 Nov, 8:00 AM', completed: true),
      TimelineStepData(title: 'Truck Assigned', timestamp: '27 Nov, 8:15 AM', completed: true),
      TimelineStepData(title: 'Picked Up', timestamp: '28 Nov, 6:10 AM', completed: true),
      TimelineStepData(title: 'In Transit', timestamp: '28 Nov, 6:30 AM', completed: true),
      TimelineStepData(title: 'Delivered', timestamp: '28 Nov, 3:45 PM', completed: true),
      TimelineStepData(title: 'Payment Released', timestamp: '28 Nov, 3:46 PM', completed: true),
    ],
  ),
  HistoryOrderData(
    orderId: '#FF20241177',
    route: 'Ahmedabad → Mumbai',
    date: '15 Nov 2024',
    amount: '₹5,800',
    status: 'Delivered',
    driver: 'Suresh Patel',
    truckNumber: 'MH 12 CD 5678',
    timeline: const [
      TimelineStepData(title: 'Order Placed', timestamp: '14 Nov, 11:00 AM', completed: true),
      TimelineStepData(title: 'Truck Assigned', timestamp: '14 Nov, 11:20 AM', completed: true),
      TimelineStepData(title: 'Picked Up', timestamp: '15 Nov, 8:00 AM', completed: true),
      TimelineStepData(title: 'Delivered', timestamp: '15 Nov, 2:20 PM', completed: true),
      TimelineStepData(title: 'Payment Released', timestamp: '15 Nov, 2:21 PM', completed: true),
    ],
  ),
  HistoryOrderData(
    orderId: '#FF20241161',
    route: 'Surat → Delhi',
    date: '2 Nov 2024',
    amount: '₹9,200',
    status: 'Cancelled',
    driver: 'Vijay Sharma',
    truckNumber: 'GJ 05 EF 7788',
    timeline: const [
      TimelineStepData(title: 'Order Placed', timestamp: '1 Nov, 9:00 AM', completed: true),
      TimelineStepData(title: 'Truck Assigned', timestamp: '1 Nov, 9:30 AM', completed: true),
      TimelineStepData(title: 'Cancelled', timestamp: '2 Nov, 10:05 AM', completed: true),
    ],
  ),
];

const mockBookingPriceLines = <PriceLineData>[
  PriceLineData(label: 'Base freight', amount: '₹5,800'),
  PriceLineData(label: 'Toll estimate', amount: '₹620'),
  PriceLineData(label: 'Platform fee', amount: '₹380'),
  PriceLineData(label: 'Total', amount: '₹6,800', isTotal: true),
];

const mockOrderDetailPriceLines = <PriceLineData>[
  PriceLineData(label: 'Base freight', amount: '₹3,400'),
  PriceLineData(label: 'Toll', amount: '₹480'),
  PriceLineData(label: 'Platform fee', amount: '₹320'),
  PriceLineData(label: 'Total paid', amount: '₹4,200', isTotal: true),
];

const mockLiveTrackers = <LiveTruckTabData>[
  LiveTruckTabData(
    label: 'Truck 1',
    driver: 'Ramesh Kumar',
    truckNumber: 'TN 45 AB 1234',
    rating: 4.8,
    eta: 'Today 4:30 PM',
    location: 'Near Vadodara, NH-48',
  ),
  LiveTruckTabData(
    label: 'Truck 2',
    driver: 'Suresh Patel',
    truckNumber: 'MH 12 CD 5678',
    rating: 4.5,
    eta: 'Tomorrow 9:00 AM',
    location: 'Bharuch bypass',
  ),
];

const mockProfileMenu = <ProfileMenuData>[
  ProfileMenuData(icon: Icons.inventory_2_rounded, title: 'Order History', subtitle: 'Open delivered and cancelled orders'),
  ProfileMenuData(icon: Icons.location_on_rounded, title: 'Saved Addresses'),
  ProfileMenuData(icon: Icons.credit_card_rounded, title: 'Payment Methods'),
  ProfileMenuData(icon: Icons.description_rounded, title: 'My Documents'),
  ProfileMenuData(icon: Icons.language_rounded, title: 'Language', subtitle: 'English / हिंदी / தமிழ்'),
  ProfileMenuData(icon: Icons.help_outline_rounded, title: 'Help & Support'),
  ProfileMenuData(icon: Icons.info_outline_rounded, title: 'About Truxify'),
  ProfileMenuData(icon: Icons.logout_rounded, title: 'Logout', isDanger: true),
];
