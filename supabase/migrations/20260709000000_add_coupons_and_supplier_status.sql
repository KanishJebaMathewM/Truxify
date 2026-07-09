-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),
  min_order_amount NUMERIC(10, 2),
  max_discount_amount NUMERIC(10, 2),
  usage_limit INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Coupon redemptions table
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code TEXT NOT NULL REFERENCES coupons(code),
  customer_id UUID NOT NULL,
  order_id UUID REFERENCES orders(id),
  discount_amount NUMERIC(10, 2) NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(coupon_code, customer_id)
);

-- Supplier status tracking table
CREATE TABLE IF NOT EXISTS supplier_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL,
  status TEXT NOT NULL,
  order_id UUID REFERENCES orders(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_id, order_id)
);

-- Atomic coupon redemption RPC
CREATE OR REPLACE FUNCTION redeem_coupon_atomic(
  p_coupon_code TEXT,
  p_customer_id UUID,
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_order_total NUMERIC(10, 2);
  v_discount NUMERIC(10, 2);
  v_result JSONB;
BEGIN
  SELECT * INTO v_coupon FROM coupons WHERE code = p_coupon_code AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found or inactive' USING ERRCODE = 'P0002';
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RAISE EXCEPTION 'Coupon has expired' USING ERRCODE = 'P0003';
  END IF;

  IF v_coupon.usage_limit IS NOT NULL AND v_coupon.used_count >= v_coupon.usage_limit THEN
    RAISE EXCEPTION 'Coupon usage limit reached' USING ERRCODE = 'P0004';
  END IF;

  SELECT total_amount INTO v_order_total FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_coupon.min_order_amount IS NOT NULL AND v_order_total < v_coupon.min_order_amount THEN
    RAISE EXCEPTION 'Minimum order amount not met' USING ERRCODE = 'P0005';
  END IF;

  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := ROUND(v_order_total * v_coupon.discount_value / 100, 2);
    IF v_coupon.max_discount_amount IS NOT NULL AND v_discount > v_coupon.max_discount_amount THEN
      v_discount := v_coupon.max_discount_amount;
    END IF;
  ELSE
    v_discount := LEAST(v_coupon.discount_value, v_order_total);
  END IF;

  UPDATE coupons SET used_count = used_count + 1, updated_at = now() WHERE code = p_coupon_code;

  INSERT INTO coupon_redemptions (coupon_code, customer_id, order_id, discount_amount)
  VALUES (p_coupon_code, p_customer_id, p_order_id, v_discount);

  v_result := jsonb_build_object(
    'discount_amount', v_discount,
    'coupon_code', p_coupon_code
  );

  RETURN v_result;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON coupon_redemptions(coupon_code, customer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_status_supplier ON supplier_status(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_status_order ON supplier_status(order_id);
