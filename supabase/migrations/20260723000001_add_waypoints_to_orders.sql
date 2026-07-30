ALTER TABLE "public"."orders" ADD COLUMN IF NOT EXISTS "waypoints" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "public"."load_offers" ADD COLUMN IF NOT EXISTS "waypoints" JSONB DEFAULT '[]'::jsonb;
