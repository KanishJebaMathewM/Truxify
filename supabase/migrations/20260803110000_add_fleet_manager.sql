CREATE TABLE IF NOT EXISTS fleets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    manager_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fleet_id UUID REFERENCES fleets(id);

ALTER TABLE fleets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on fleets"
  ON fleets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Managers select own fleet"
  ON fleets FOR SELECT TO authenticated
  USING (manager_id = get_profile_id());
  
CREATE POLICY "Drivers select their fleet"
  ON fleets FOR SELECT TO authenticated
  USING (id = (SELECT fleet_id FROM profiles WHERE id = get_profile_id()));
