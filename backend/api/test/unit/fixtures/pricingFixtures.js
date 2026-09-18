/**
 * @fileoverview Test fixtures for the pricing engine.
 * Provides reusable, realistic order scenarios for comprehensive testing.
 */

/**
 * Geographic coordinates for major Indian cities (lat/lng)
 */
export const INDIAN_CITIES = {
    DELHI: { lat: 28.6139, lng: 77.2090 },
    MUMBAI: { lat: 19.0760, lng: 72.8777 },
    BANGALORE: { lat: 12.9716, lng: 77.5946 },
    CHENNAI: { lat: 13.0827, lng: 80.2707 },
    KOLKATA: { lat: 22.5726, lng: 88.3639 },
    HYDERABAD: { lat: 17.3850, lng: 78.4867 },
    PUNE: { lat: 18.5204, lng: 73.8567 },
    AHMEDABAD: { lat: 23.0225, lng: 72.5714 },
    JAIPUR: { lat: 26.9124, lng: 75.7873 },
    LUCKNOW: { lat: 26.8467, lng: 80.9462 },
};

/**
 * Predefined routes with approximate distances
 */
export const POPULAR_ROUTES = {
    DELHI_MUMBAI: {
        from: INDIAN_CITIES.DELHI,
        to: INDIAN_CITIES.MUMBAI,
        approxDistanceKm: 1400,
        description: 'Delhi to Mumbai (Golden Quadrilateral)',
    },
    DELHI_BANGALORE: {
        from: INDIAN_CITIES.DELHI,
        to: INDIAN_CITIES.BANGALORE,
        approxDistanceKm: 2100,
        description: 'Delhi to Bangalore (North-South corridor)',
    },
    MUMBAI_CHENNAI: {
        from: INDIAN_CITIES.MUMBAI,
        to: INDIAN_CITIES.CHENNAI,
        approxDistanceKm: 1300,
        description: 'Mumbai to Chennai (West-East corridor)',
    },
    DELHI_KOLKATA: {
        from: INDIAN_CITIES.DELHI,
        to: INDIAN_CITIES.KOLKATA,
        approxDistanceKm: 1500,
        description: 'Delhi to Kolkata',
    },
    CHENNAI_BANGALORE: {
        from: INDIAN_CITIES.CHENNAI,
        to: INDIAN_CITIES.BANGALORE,
        approxDistanceKm: 350,
        description: 'Short haul - Chennai to Bangalore',
    },
    MUMBAI_PUNE: {
        from: INDIAN_CITIES.MUMBAI,
        to: INDIAN_CITIES.PUNE,
        approxDistanceKm: 150,
        description: 'Very short haul - Mumbai to Pune',
    },
};

/**
 * Cargo types with realistic weights
 */
export const CARGO_SCENARIOS = {
    LIGHT_PARCEL: {
        weightTonnes: 0.5,
        description: 'Light parcel / e-commerce',
        isFragile: false,
        isStackable: true,
    },
    GENERAL_FREIGHT: {
        weightTonnes: 10,
        description: 'Standard general freight',
        isFragile: false,
        isStackable: false,
    },
    HEAVY_MACHINERY: {
        weightTonnes: 25,
        description: 'Heavy industrial machinery',
        isFragile: false,
        isStackable: false,
    },
    FRAGILE_ELECTRONICS: {
        weightTonnes: 5,
        description: 'Fragile electronics / glass',
        isFragile: true,
        isStackable: false,
    },
    BULK_STACKABLE: {
        weightTonnes: 15,
        description: 'Bulk stackable goods (bags, boxes)',
        isFragile: false,
        isStackable: true,
    },
    OVERSIZED: {
        weightTonnes: 40,
        description: 'Oversized / heavy load',
        isFragile: false,
        isStackable: false,
    },
};

/**
 * Complete valid order inputs for testing
 */
export const SAMPLE_ORDERS = {
    STANDARD_DELHI_MUMBAI: {
        pickupLat: INDIAN_CITIES.DELHI.lat,
        pickupLng: INDIAN_CITIES.DELHI.lng,
        dropLat: INDIAN_CITIES.MUMBAI.lat,
        dropLng: INDIAN_CITIES.MUMBAI.lng,
        weightTonnes: 10,
        roadDistanceKm: 1400,
        isFragile: false,
        isStackable: false,
    },
    FRAGILE_SHORT_HAUL: {
        pickupLat: INDIAN_CITIES.MUMBAI.lat,
        pickupLng: INDIAN_CITIES.MUMBAI.lng,
        dropLat: INDIAN_CITIES.PUNE.lat,
        dropLng: INDIAN_CITIES.PUNE.lng,
        weightTonnes: 2,
        roadDistanceKm: 150,
        isFragile: true,
        isStackable: false,
    },
    HEAVY_LONG_HAUL: {
        pickupLat: INDIAN_CITIES.DELHI.lat,
        pickupLng: INDIAN_CITIES.DELHI.lng,
        dropLat: INDIAN_CITIES.CHENNAI.lat,
        dropLng: INDIAN_CITIES.CHENNAI.lng,
        weightTonnes: 30,
        roadDistanceKm: 2200,
        isFragile: false,
        isStackable: false,
    },
    STACKABLE_MEDIUM: {
        pickupLat: INDIAN_CITIES.BANGALORE.lat,
        pickupLng: INDIAN_CITIES.BANGALORE.lng,
        dropLat: INDIAN_CITIES.HYDERABAD.lat,
        dropLng: INDIAN_CITIES.HYDERABAD.lng,
        weightTonnes: 12,
        roadDistanceKm: 570,
        isFragile: false,
        isStackable: true,
    },
    SAME_CITY: {
        pickupLat: INDIAN_CITIES.DELHI.lat,
        pickupLng: INDIAN_CITIES.DELHI.lng,
        dropLat: INDIAN_CITIES.DELHI.lat,
        dropLng: INDIAN_CITIES.DELHI.lng,
        weightTonnes: 5,
        roadDistanceKm: 0,
        isFragile: false,
        isStackable: false,
    },
};

/**
 * Custom rate cards for testing different scenarios
 */
export const RATE_CARDS = {
    DEFAULT: {
        ratePerTonneKm: 50,
        fragileMultiplier: 1.5,
        stackableDiscount: 0.9,
        handlingFee: 30000,
        platformFeePct: 5,
        fuelCostPct: 45,
        tollPerKm: 200,
    },
    PREMIUM: {
        ratePerTonneKm: 75,
        fragileMultiplier: 2.0,
        stackableDiscount: 0.85,
        handlingFee: 50000,
        platformFeePct: 8,
        fuelCostPct: 50,
        tollPerKm: 250,
    },
    BUDGET: {
        ratePerTonneKm: 35,
        fragileMultiplier: 1.3,
        stackableDiscount: 0.95,
        handlingFee: 20000,
        platformFeePct: 3,
        fuelCostPct: 40,
        tollPerKm: 150,
    },
    ZERO_PLATFORM_FEE: {
        ratePerTonneKm: 50,
        fragileMultiplier: 1.5,
        stackableDiscount: 0.9,
        handlingFee: 30000,
        platformFeePct: 0,
        fuelCostPct: 45,
        tollPerKm: 200,
    },
    HIGH_TOLL: {
        ratePerTonneKm: 50,
        fragileMultiplier: 1.5,
        stackableDiscount: 0.9,
        handlingFee: 30000,
        platformFeePct: 5,
        fuelCostPct: 45,
        tollPerKm: 500,
    },
};

/**
 * Edge case inputs for boundary testing
 */
export const EDGE_CASES = {
    ZERO_WEIGHT: {
        weightTonnes: 0,
        shouldThrow: true,
        errorType: RangeError,
    },
    NEGATIVE_WEIGHT: {
        weightTonnes: -5,
        shouldThrow: true,
        errorType: RangeError,
    },
    VERY_SMALL_WEIGHT: {
        weightTonnes: 0.001,
        shouldThrow: false,
    },
    VERY_LARGE_WEIGHT: {
        weightTonnes: 1000,
        shouldThrow: false,
    },
    ZERO_DISTANCE: {
        roadDistanceKm: 0,
        shouldThrow: false,
    },
    VERY_SHORT_DISTANCE: {
        roadDistanceKm: 0.5,
        shouldThrow: false,
    },
    VERY_LONG_DISTANCE: {
        roadDistanceKm: 5000,
        shouldThrow: false,
    },
    INVALID_COORDINATES: {
        pickupLat: NaN,
        shouldThrow: true,
        errorType: TypeError,
    },
};

/**
 * Expected output ranges for validation
 */
export const EXPECTED_RANGES = {
    PLATFORM_FEE_PERCENTAGE: { min: 0, max: 20 },
    FUEL_COST_PERCENTAGE: { min: 30, max: 60 },
    DELHI_MUMBAI_DISTANCE_KM: { min: 1100, max: 1200 },
    SHORT_HAUL_MIN_AMOUNT_PAISA: 500000, // ₹5,000
    LONG_HAUL_MIN_AMOUNT_PAISA: 5000000, // ₹50,000
};
