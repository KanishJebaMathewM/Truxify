-- Migration: Composite LTL Multi-Consignment Trips & 3D Packing Layouts
-- Enables Less-Than-Truckload (LTL) cargo consolidation across multiple customer bookings.

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
    is_axle_balanced BOOLEAN DEFAULT TRUE,
    total_distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    estimated_duration_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
    itinerary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_composite_trips_driver ON composite_trips(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_composite_trips_status ON composite_trips(status, created_at);

-- Child Consignment Linkage Table
CREATE TABLE IF NOT EXISTS trip_consignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    composite_trip_id UUID NOT NULL REFERENCES composite_trips(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    consignment_weight_kg NUMERIC(10, 2) NOT NULL,
    pickup_stop_sequence INTEGER NOT NULL,
    delivery_stop_sequence INTEGER NOT NULL,
    packed_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payout_paisa BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_consignments_parent ON trip_consignments(composite_trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_consignments_booking ON trip_consignments(booking_id);
