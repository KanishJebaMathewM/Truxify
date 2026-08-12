-- Add INSERT and UPDATE policies for authenticated role on tracking_tokens
-- Fixes: POST /api/orders/:id/share-tracking returns 500 because the route uses
-- createUserClient(req.token) (authenticated role) but the table only had
-- INSERT/UPDATE policies for service_role.
create policy "authenticated_insert_tracking_tokens"
  on tracking_tokens
  for insert
  to authenticated
  with check (
    created_by = (
      select id from profiles
      where firebase_uid = (auth.jwt() ->> 'sub')
      limit 1
    )
  );
create policy "authenticated_update_tracking_tokens"
  on tracking_tokens
  for update
  to authenticated
  using (
    created_by = (
      select id from profiles
      where firebase_uid = (auth.jwt() ->> 'sub')
      limit 1
    )
  )
  with check (
    created_by = (
      select id from profiles
      where firebase_uid = (auth.jwt() ->> 'sub')
      limit 1
    )
  );
