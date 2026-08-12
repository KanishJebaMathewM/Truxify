-- ============================================================================
-- MIGRATION 003: SUPPORT TICKET COMMENTS
-- ============================================================================
-- Fixes: backend/api/src/routes/supportRoutes.js inserts into and selects
-- from `support_ticket_comments`, but no migration ever created this table.
-- POST/GET /api/support/tickets/:id/comments currently 500s because
-- PostgREST reports relation "support_ticket_comments" does not exist.
--
-- Columns match exactly what supportRoutes.js reads/writes:
--   id, ticket_id, user_id, user_name, message, created_at
-- ============================================================================

create table if not exists support_ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null,                                  -- support_tickets.id
  user_id     uuid not null,                                  -- profiles.id
  user_name   text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_support_ticket_comments_ticket
  on support_ticket_comments (ticket_id);

create index if not exists idx_support_ticket_comments_user
  on support_ticket_comments (user_id);

alter table support_ticket_comments
  add constraint support_ticket_comments_ticket_id_fkey
  foreign key (ticket_id) references support_tickets(id)
  on update cascade on delete cascade;

alter table support_ticket_comments
  add constraint support_ticket_comments_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete restrict;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table support_ticket_comments enable row level security;

create policy "Service role full access on support_ticket_comments"
  on support_ticket_comments for all
  to service_role
  using (true) with check (true);

-- A user may see/add comments on a ticket if they own the ticket or are admin.
-- get_profile_id() is the existing helper defined in supabase_setup.sql.
create policy "Users view comments on own tickets"
  on support_ticket_comments for select
  to authenticated
  using (
    ticket_id in (
      select id from support_tickets where user_id = get_profile_id()
    )
  );

create policy "Users insert comments on own tickets"
  on support_ticket_comments for insert
  to authenticated
  with check (
    user_id = get_profile_id()
    and ticket_id in (
      select id from support_tickets where user_id = get_profile_id()
    )
  );

-- ============================================================================
-- END MIGRATION 003
-- ============================================================================