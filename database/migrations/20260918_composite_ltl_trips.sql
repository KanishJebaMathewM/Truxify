
-- Migration: Composite LTL Multi-Consignment Trips & 3D Packing Layouts
-- Supports cargo consolidation across multiple customer bookings.

-- ============================================
-- 1. COMPOSITE TRIPS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS composite_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    driver_id UUID NOT NULL,
    vehicle_registration VARCHAR(32) NOT NULL,

    vehicle_max_weight_kg NUMERIC(10, 2) NOT NULL DEFAULT 25000.00,
    vehicle_length_m NUMERIC(5, 2) NOT NULL DEFAULT 12.00,
    vehicle_width_m NUMERIC(5, 2) NOT NULL DEFAULT 2.40,
    vehicle_height_m NUMERIC(5, 2) NOT NULL DEFAULT 2.60,

    total_consignments INTEGER NOT NULL DEFAULT 0,
    total_weight_kg NUMERIC(10, 2) NOT NULL DEFAULT 0.00,

    volume_utilization_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    center_of_gravity_x_m NUMERIC(5, 3),

    is_axle_balanced BOOLEAN NOT NULL DEFAULT TRUE,

    total_distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    estimated_duration_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00,

    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',

    itinerary_json JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Validation constraints
    CONSTRAINT chk_vehicle_weight
        CHECK (vehicle_max_weight_kg > 0),

    CONSTRAINT chk_vehicle_length
        CHECK (vehicle_length_m > 0),

    CONSTRAINT chk_vehicle_width
        CHECK (vehicle_width_m > 0),

    CONSTRAINT chk_vehicle_height
        CHECK (vehicle_height_m > 0),

    CONSTRAINT chk_total_consignments
        CHECK (total_consignments >= 0),

    CONSTRAINT chk_total_weight
        CHECK (total_weight_kg >= 0),

    CONSTRAINT chk_volume_utilization
        CHECK (volume_utilization_pct BETWEEN 0 AND 100),

    CONSTRAINT chk_center_of_gravity
        CHECK (
            center_of_gravity_x_m IS NULL
            OR center_of_gravity_x_m BETWEEN 0 AND vehicle_length_m
        ),

    CONSTRAINT chk_distance
        CHECK (total_distance_km >= 0),

    CONSTRAINT chk_duration
        CHECK (estimated_duration_hours >= 0),

    CONSTRAINT chk_vehicle_registration
        CHECK (LENGTH(TRIM(vehicle_registration)) > 0),

    CONSTRAINT chk_trip_status
        CHECK (LENGTH(TRIM(status)) > 0),

    CONSTRAINT chk_itinerary_json
        CHECK (jsonb_typeof(itinerary_json) = 'array')
);

-- ============================================
-- 2. COMPOSITE TRIP INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_composite_trips_driver
ON composite_trips(driver_id, status);

CREATE INDEX IF NOT EXISTS idx_composite_trips_status
ON composite_trips(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_composite_trips_created
ON composite_trips(created_at DESC);


-- ============================================
-- 3. TRIP CONSIGNMENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS trip_consignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    composite_trip_id UUID NOT NULL
        REFERENCES composite_trips(id)
        ON DELETE CASCADE,

    booking_id UUID NOT NULL,
    customer_id UUID NOT NULL,

    consignment_weight_kg NUMERIC(10, 2) NOT NULL,

    pickup_stop_sequence INTEGER NOT NULL,
    delivery_stop_sequence INTEGER NOT NULL,

    packed_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    payout_paisa BIGINT NOT NULL,

    status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Validation constraints
    CONSTRAINT chk_consignment_weight
        CHECK (consignment_weight_kg > 0),

    CONSTRAINT chk_pickup_sequence
        CHECK (pickup_stop_sequence >= 0),

    CONSTRAINT chk_delivery_sequence
        CHECK (delivery_stop_sequence >= 0),

    CONSTRAINT chk_stop_order
        CHECK (pickup_stop_sequence < delivery_stop_sequence),

    CONSTRAINT chk_payout
        CHECK (payout_paisa >= 0),

    CONSTRAINT chk_consignment_status
        CHECK (LENGTH(TRIM(status)) > 0),

    CONSTRAINT chk_packed_coordinates
        CHECK (jsonb_typeof(packed_coordinates_json) = 'object'),

    -- Prevent assigning one booking to multiple trips
    CONSTRAINT uq_trip_booking
        UNIQUE (booking_id)
);


-- ============================================
-- 4. CONSIGNMENT INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_trip_consignments_parent
ON trip_consignments(composite_trip_id);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_booking
ON trip_consignments(booking_id);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_customer
ON trip_consignments(customer_id);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_status
ON trip_consignments(status);


-- ============================================
-- 5. AUTOMATIC UPDATED_AT TIMESTAMP
-- ============================================

CREATE OR REPLACE FUNCTION update_composite_trip_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_composite_trip_updated_at
ON composite_trips;

CREATE TRIGGER trg_composite_trip_updated_at
BEFORE UPDATE ON composite_trips
FOR EACH ROW
EXECUTE FUNCTION update_composite_trip_timestamp();


-- ============================================
-- MIGRATION COMPLETED
-- ============================================
