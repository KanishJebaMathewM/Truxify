CREATE TYPE eway_bill_status AS ENUM (
  'PENDING_VERIFICATION',
  'VERIFIED',
  'AT_RISK',
  'EXTENDED',
  'EXPIRED',
  'REJECTED'
);

CREATE TABLE IF NOT EXISTS public.eway_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ewb_number VARCHAR(12) NOT NULL UNIQUE,
  consignor_gstin VARCHAR(15) NOT NULL,
  consignee_gstin VARCHAR(15) NOT NULL,
  invoice_value NUMERIC(14, 2) NOT NULL,
  vehicle_number VARCHAR(15) NOT NULL,
  origin_pincode VARCHAR(6) NOT NULL,
  destination_pincode VARCHAR(6) NOT NULL,
  remaining_distance_km NUMERIC(10, 2) NOT NULL,
  valid_upto TIMESTAMPTZ NOT NULL,
  extension_count INT NOT NULL DEFAULT 0,
  status eway_bill_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  last_known_lat DOUBLE PRECISION,
  last_known_lng DOUBLE PRECISION,
  last_telemetry_at TIMESTAMPTZ,
  payload_sha256 VARCHAR(64),
  polygon_tx_hash VARCHAR(66),
  audit_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eway_bills_valid_upto_status ON public.eway_bills (valid_upto, status);
CREATE INDEX idx_eway_bills_order_id ON public.eway_bills (order_id);