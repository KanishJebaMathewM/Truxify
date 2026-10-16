-- Create or replace the append_maintenance_photos RPC function
CREATE OR REPLACE FUNCTION public.append_maintenance_photos(
    p_ticket_id UUID,
    p_photos JSONB
)
RETURNS SETOF maintenance_photos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    photo_record JSONB;
    inserted_row maintenance_photos%ROWTYPE;
BEGIN
    -- Verify ticket exists and user has access (RLS / ownership check can be added if needed)
    IF NOT EXISTS (SELECT 1 FROM maintenance_tickets WHERE id = p_ticket_id) THEN
        RAISE EXCEPTION 'Maintenance ticket not found: %', p_ticket_id;
    END IF;

    -- Iterate and insert each photo record from the JSONB array
    FOR photo_record IN SELECT * FROM jsonb_array_elements(p_photos)
    LOOP
        INSERT INTO maintenance_photos (
            ticket_id,
            photo_url,
            file_name,
            file_size,
            uploaded_by,
            created_at
        )
        VALUES (
            p_ticket_id,
            photo_record->>'photo_url',
            photo_record->>'file_name',
            (photo_record->>'file_size')::INTEGER,
            (photo_record->>'uploaded_by')::UUID,
            COALESCE((photo_record->>'created_at')::TIMESTAMPTZ, NOW())
        )
        RETURNING * INTO inserted_row;

        RETURN NEXT inserted_row;
    END LOOP;

    RETURN;
END;
$$;

-- Grant execute permissions to authenticated and service roles
GRANT EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, JSONB) TO service_role;
