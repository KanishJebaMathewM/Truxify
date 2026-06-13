-- Migration: Add unique constraint on (driver_id, day_date) in earnings_daily table

-- 1. Identify and aggregate duplicate daily earnings records (summing amount, trip_count, and hours_driven)
CREATE TEMP TABLE temp_earnings_daily AS
SELECT 
  min(id) as id,
  driver_id,
  day_date,
  sum(amount) as amount,
  sum(trip_count) as trip_count,
  sum(hours_driven) as hours_driven,
  min(created_at) as created_at
FROM earnings_daily
GROUP BY driver_id, day_date;

-- 2. Clear original table to prepare for constraint addition
DELETE FROM earnings_daily;

-- 3. Re-insert the aggregated records
INSERT INTO earnings_daily (id, driver_id, day_date, amount, trip_count, hours_driven, created_at)
SELECT id, driver_id, day_date, amount, trip_count, hours_driven, created_at FROM temp_earnings_daily;

-- 4. Clean up temporary table
DROP TABLE temp_earnings_daily;

-- 5. Add unique constraint to the table
ALTER TABLE earnings_daily
ADD CONSTRAINT earnings_daily_driver_day_unique UNIQUE (driver_id, day_date);
