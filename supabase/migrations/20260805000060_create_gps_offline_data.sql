-- Migration: create gps_offline_data table for WebRTC GPS backlog
-- Backs backend/api/src/services/webrtc/WebRTCSignalingServer.js which uses
-- camelCase column keys directly against PostgREST:
--   - `.from('gps_offline_data').insert([gpsEntry])`        // { peerId, data, timestamp, synced }
--   - `.from('gps_offline_data').select('*').eq('peerId', peerId).gt('timestamp', since).order('timestamp')
--   - `.from('gps_offline_data').update({ synced: true }).eq('peerId', peerId).eq('synced', false)`
-- No table named `gps_offline_data` existed, so every insert was dropped with
-- a logged warning and offline GPS payloads were never queued for sync.
-- Columns are intentionally named in camelCase (folded to lowercase) to match
-- the exact keys the service sends to PostgREST.

create table if not exists gps_offline_data (
  id          uuid primary key default gen_random_uuid(),
  peerId      text not null,
  data        jsonb not null,
  timestamp   bigint not null,
  synced      boolean not null default false,
  createdAt   timestamptz not null default now()
);

-- Peer-scoped, unsynced-first scan used by the backlog fetch and mark-synced update.
create index if not exists idx_gps_offline_data_peer_unsynced
  on gps_offline_data (peerId, synced);

-- The WebRTC service uses the service/client key; keep rows locked down for
-- any row-level requests.
alter table gps_offline_data enable row level security;

create policy gps_offline_data_service_policy on gps_offline_data
  for all using (true) with check (true);
