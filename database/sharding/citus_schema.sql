-- Citus Distributed Sharding Schema Optimization
-- Partitions high-volume tables across distributed database nodes by driver_id

-- 1. Enable Citus extension if not present
CREATE EXTENSION IF NOT EXISTS citus;

-- 2. Define sharding keys for telemetry pings table
SELECT create_distributed_table('telemetry_pings', 'driver_id');

-- 3. Define sharding keys for driver status log table
SELECT create_distributed_table('driver_status_logs', 'driver_id');

-- 4. Enforce Table Co-Location for joint localized worker node queries
-- This ensures queries linking drivers and telemetry avoid distributed network jumps
ALTER TABLE driver_status_logs ADD CONSTRAINT fk_driver_telemetry
FOREIGN KEY (driver_id) REFERENCES driver_details(driver_id);
