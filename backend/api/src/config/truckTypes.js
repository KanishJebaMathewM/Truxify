// backend/api/src/config/truckTypes.js

export const SUPPORTED_TRUCK_TYPES = [
  { id: 'mini_truck', name: 'Mini Truck / Tata Ace', capacityTons: 1.0, description: 'Ideal for city deliveries and small loads.' },
  { id: 'lcv', name: 'Light Commercial Vehicle (LCV)', capacityTons: 3.5, description: 'Suitable for medium inter-city transport.' },
  { id: 'hcv', name: 'Heavy Commercial Vehicle (HCV)', capacityTons: 16.0, description: 'For heavy industrial cargo.' },
  { id: 'container_20ft', name: '20ft Container', capacityTons: 7.0, description: 'Weatherproof containerized freight.' },
  { id: 'container_32ft', name: '32ft Multi-Axle Container', capacityTons: 21.0, description: 'High-capacity long-haul logistics.' },
  { id: 'open_body', name: 'Open Body Truck', capacityTons: 10.0, description: 'Versatile open-deck freight transport.' }
];
