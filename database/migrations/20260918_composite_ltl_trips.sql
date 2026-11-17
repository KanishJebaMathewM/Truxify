
-- ============================================================
-- MIGRATION: LTL MULTI-CONSIGNMENT TRIPS & 3D PACKING LAYOUTS
-- Supports cargo consolidation across multiple customer bookings
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. COMPOSITE TRIPS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS composite_trips (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    driver_id UUID NOT NULL,
    vehicle_registration VARCHAR(32) NOT NULL,

    -- Vehicle capacity and dimensions

    vehicle_max_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 25000.00,

    vehicle_length_m NUMERIC(8,3) NOT NULL DEFAULT 12.000,
    vehicle_width_m NUMERIC(8,3) NOT NULL DEFAULT 2.400,
    vehicle_height_m NUMERIC(8,3) NOT NULL DEFAULT 2.600,

    -- Consignment statistics

    total_consignments INTEGER NOT NULL DEFAULT 0,
    total_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    -- 3D packing utilization

    total_volume_m3 NUMERIC(12,3) NOT NULL DEFAULT 0.000,
    volume_utilization_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,

    -- Center of gravity

    center_of_gravity_x_m NUMERIC(8,3),
    center_of_gravity_y_m NUMERIC(8,3),
    center_of_gravity_z_m NUMERIC(8,3),

    is_axle_balanced BOOLEAN NOT NULL DEFAULT TRUE,

    -- Route information

    total_distance_km NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    estimated_duration_hours NUMERIC(8,2) NOT NULL DEFAULT 0.00,

    -- Trip lifecycle

    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',

    itinerary_json JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints

    CONSTRAINT chk_vehicle_weight
        CHECK (vehicle_max_weight_kg > 0),

    CONSTRAINT chk_vehicle_dimensions
        CHECK (
            vehicle_length_m > 0
            AND vehicle_width_m > 0
            AND vehicle_height_m > 0
        ),

    CONSTRAINT chk_total_consignments
        CHECK (total_consignments >= 0),

    CONSTRAINT chk_total_weight
        CHECK (
            total_weight_kg >= 0
            AND total_weight_kg <= vehicle_max_weight_kg
        ),

    CONSTRAINT chk_total_volume
        CHECK (total_volume_m3 >= 0),

    CONSTRAINT chk_volume_utilization
        CHECK (volume_utilization_pct BETWEEN 0 AND 100),

    CONSTRAINT chk_center_of_gravity
        CHECK (
            (center_of_gravity_x_m IS NULL OR
             center_of_gravity_x_m BETWEEN 0 AND vehicle_length_m)
            AND
            (center_of_gravity_y_m IS NULL OR
             center_of_gravity_y_m BETWEEN 0 AND vehicle_width_m)
            AND
            (center_of_gravity_z_m IS NULL OR
             center_of_gravity_z_m BETWEEN 0 AND vehicle_height_m)
        ),

    CONSTRAINT chk_distance
        CHECK (total_distance_km >= 0),

    CONSTRAINT chk_duration
        CHECK (estimated_duration_hours >= 0),

    CONSTRAINT chk_vehicle_registration
        CHECK (
            LENGTH(TRIM(vehicle_registration)) > 0
        ),

    CONSTRAINT chk_trip_status
        CHECK (
            LENGTH(TRIM(status)) > 0
        ),

    CONSTRAINT chk_itinerary_json
        CHECK (
            jsonb_typeof(itinerary_json) = 'array'
        )
);


-- ============================================================
-- 2. COMPOSITE TRIP INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_composite_trips_driver
ON composite_trips(driver_id, status);

CREATE INDEX IF NOT EXISTS idx_composite_trips_status
ON composite_trips(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_composite_trips_created
ON composite_trips(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_composite_trips_vehicle
ON composite_trips(vehicle_registration);

CREATE INDEX IF NOT EXISTS idx_composite_trips_itinerary
ON composite_trips USING GIN(itinerary_json);


-- ============================================================
-- 3. TRIP CONSIGNMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_consignments (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    composite_trip_id UUID NOT NULL
        REFERENCES composite_trips(id)
        ON DELETE CASCADE,

    booking_id UUID NOT NULL,
    customer_id UUID NOT NULL,

    -- Cargo information

    consignment_weight_kg NUMERIC(12,2) NOT NULL,

    -- Pickup and delivery sequence

    pickup_stop_sequence INTEGER NOT NULL,
    delivery_stop_sequence INTEGER NOT NULL,

    -- 3D packing coordinates

    packed_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Driver payout in paisa

    payout_paisa BIGINT NOT NULL DEFAULT 0,

    status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints

    CONSTRAINT chk_consignment_weight
        CHECK (consignment_weight_kg > 0),

    CONSTRAINT chk_pickup_sequence
        CHECK (pickup_stop_sequence >= 0),

    CONSTRAINT chk_delivery_sequence
        CHECK (delivery_stop_sequence >= 0),

    CONSTRAINT chk_stop_order
        CHECK (
            pickup_stop_sequence < delivery_stop_sequence
        ),

    CONSTRAINT chk_payout
        CHECK (payout_paisa >= 0),

    CONSTRAINT chk_consignment_status
        CHECK (LENGTH(TRIM(status)) > 0),

    CONSTRAINT chk_packed_coordinates
        CHECK (
            jsonb_typeof(packed_coordinates_json) = 'object'
        ),

    -- Validate optional 3D coordinate values

    CONSTRAINT chk_packing_coordinates
        CHECK (
            (
                NOT (packed_coordinates_json ? 'x')
                OR jsonb_typeof(packed_coordinates_json->'x') = 'number'
            )
            AND
            (
                NOT (packed_coordinates_json ? 'y')
                OR jsonb_typeof(packed_coordinates_json->'y') = 'number'
            )
            AND
            (
                NOT (packed_coordinates_json ? 'z')
                OR jsonb_typeof(packed_coordinates_json->'z') = 'number'
            )
        ),

    -- Prevent negative packing coordinates

    CONSTRAINT chk_nonnegative_coordinates
        CHECK (
            COALESCE((packed_coordinates_json->>'x')::numeric, 0) >= 0
            AND
            COALESCE((packed_coordinates_json->>'y')::numeric, 0) >= 0
            AND
            COALESCE((packed_coordinates_json->>'z')::numeric, 0) >= 0
        ),

    -- Prevent assigning the same booking to multiple trips

    CONSTRAINT uq_trip_booking
        UNIQUE (booking_id)
);


-- ============================================================
-- 4. CONSIGNMENT INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_trip_consignments_parent
ON trip_consignments(composite_trip_id);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_customer
ON trip_consignments(customer_id);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_status
ON trip_consignments(status);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_trip_status
ON trip_consignments(composite_trip_id, status);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_coordinates
ON trip_consignments USING GIN(packed_coordinates_json);


-- ============================================================
-- 5. AUTOMATIC UPDATED_AT TIMESTAMP
-- ============================================================

CREATE OR REPLACE FUNCTION update_modified_timestamp()
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
EXECUTE FUNCTION update_modified_timestamp();


DROP TRIGGER IF EXISTS trg_trip_consignment_updated_at
ON trip_consignments;

CREATE TRIGGER trg_trip_consignment_updated_at
BEFORE UPDATE ON trip_consignments
FOR EACH ROW
EXECUTE FUNCTION update_modified_timestamp();


-- ============================================================
-- 6. DATABASE DOCUMENTATION
-- ============================================================

COMMENT ON TABLE composite_trips IS
'Stores consolidated LTL trips containing multiple customer consignments and vehicle packing information.';

COMMENT ON TABLE trip_consignments IS
'Maps customer bookings to composite trips with pickup, delivery, payout and 3D packing information.';

COMMENT ON COLUMN composite_trips.itinerary_json IS
'Stores ordered pickup and delivery stops for the composite trip.';

COMMENT ON COLUMN trip_consignments.packed_coordinates_json IS
'Stores the 3D cargo placement coordinates within the vehicle.';

COMMENT ON COLUMN trip_consignments.payout_paisa IS
'Driver payout amount stored in integer paisa to avoid floating-point precision errors.';


-- ============================================================
-- MIGRATION COMPLETED
-- ============================================================

COMMIT;
