-- Supabase PostgreSQL Row-Level Security (RLS) Performance Benchmark & Index Optimization

-- 1. Create targeted composite B-Tree indexes to prevent sequential scans
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_driver_status ON orders(driver_id, status);

-- 2. Security Definer Helper Function for RLS Auth Lookups
CREATE OR REPLACE FUNCTION is_order_participant(p_order_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM orders 
        WHERE id = p_order_id AND (customer_id = p_user_id OR driver_id = p_user_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. EXPLAIN ANALYZE Performance Check
EXPLAIN ANALYZE 
SELECT * FROM orders 
WHERE customer_id = '00000000-0000-0000-0000-000000000001'::uuid 
  AND status = 'in_transit';
