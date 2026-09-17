ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS hos_status VARCHAR(20) DEFAULT 'off_duty';
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS shift_start_time TIMESTAMPTZ;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS accumulated_driving_minutes INTEGER DEFAULT 0;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS accumulated_on_duty_minutes INTEGER DEFAULT 0;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS last_status_update_time TIMESTAMPTZ;
