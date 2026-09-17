-- Migration: create support_ticket_comments table
-- Backs POST/GET /api/support/tickets/:id/comments in backend/api/src/routes/supportRoutes.js
-- (inserts at line 860, selects at line 973). Columns match what the route reads/writes.
CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null,                          -- support_tickets.id
  user_id    uuid not null,                          -- profiles.id
  user_name  text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket
  ON support_ticket_comments (ticket_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_user
  ON support_ticket_comments (user_id);

ALTER TABLE support_ticket_comments
  ADD CONSTRAINT support_ticket_comments_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE support_ticket_comments
  ADD CONSTRAINT support_ticket_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- RLS: users may see/add comments on their own tickets; admins manage all.
ALTER TABLE support_ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on support_ticket_comments"
  ON support_ticket_comments FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "users view comments on own tickets"
  ON support_ticket_comments FOR SELECT
  TO authenticated
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets WHERE user_id = get_profile_id()
    )
  );

CREATE POLICY "users insert comments on own tickets"
  ON support_ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = get_profile_id()
    AND ticket_id IN (
      SELECT id FROM support_tickets WHERE user_id = get_profile_id()
    )
  );
