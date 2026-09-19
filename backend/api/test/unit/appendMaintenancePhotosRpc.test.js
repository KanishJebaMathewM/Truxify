import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260811000000_create_append_maintenance_photos.sql'
);

/**
 * Functional simulation of the PL/pgSQL append_maintenance_photos function
 * directly reflecting migrations/20260811000000_create_append_maintenance_photos.sql.
 */
function executeAppendMaintenancePhotos({
  authUid,
  profileMap,
  ticketsStore,
  ticketId,
  newPaths,
  maxPhotos = 3,
}) {
  // 1. Reject unauthenticated callers (auth.uid() IS NULL)
  if (!authUid) {
    throw new Error('Unauthorized');
  }

  // 2. Resolve caller profile via get_profile_id()
  const callerProfileId = profileMap[authUid] || null;
  if (!callerProfileId) {
    throw new Error('Unauthorized: Profile not found');
  }

  // 3. Lock ticket row
  const ticket = ticketsStore.find((t) => t.id === ticketId);
  if (!ticket) {
    throw new Error('MAINTENANCE_TICKET_NOT_FOUND');
  }

  // 4. Verify ownership (no service_role bypass)
  if (!ticket.driver_id || callerProfileId !== ticket.driver_id) {
    throw new Error('Access Denied: You do not own this maintenance ticket.');
  }

  // 5. Check max photos cap
  const existingCount = Array.isArray(ticket.photo_urls) ? ticket.photo_urls.length : 0;
  const newCount = Array.isArray(newPaths) ? newPaths.length : 0;
  if (existingCount + newCount > maxPhotos) {
    throw new Error('MAX_PHOTOS_EXCEEDED');
  }

  // 6. Append photo URLs atomically
  ticket.photo_urls = [...(ticket.photo_urls || []), ...(newPaths || [])];
  return ticket;
}

describe('append_maintenance_photos RPC Migration Security Audit', () => {
  let sqlContent;

  beforeEach(() => {
    sqlContent = fs.readFileSync(MIGRATION_PATH, 'utf8');
  });

  it('defines public.append_maintenance_photos with exact signature (UUID, TEXT[], INTEGER)', () => {
    expect(sqlContent).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.append_maintenance_photos\s*\(\s*p_ticket_id\s+UUID,\s*p_new_paths\s+TEXT\[\],\s*p_max_photos\s+INTEGER\s*\)/i
    );
  });

  it('uses SECURITY DEFINER and sets search_path = public, pg_temp', () => {
    expect(sqlContent).toContain('SECURITY DEFINER');
    expect(sqlContent).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/i);
  });

  it('rejects unauthenticated callers when auth.uid() IS NULL', () => {
    expect(sqlContent).toMatch(/IF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'Unauthorized';/i);
  });

  it('resolves caller application profile using get_profile_id() and rejects when null', () => {
    expect(sqlContent).toMatch(/v_caller_profile_id\s*:=\s*get_profile_id\(\);/i);
    expect(sqlContent).toMatch(/IF\s+v_caller_profile_id\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'Unauthorized:\s*Profile not found';/i);
  });

  it('locks the ticket row with FOR UPDATE', () => {
    expect(sqlContent).toMatch(/SELECT\s+\*\s+INTO\s+v_ticket\s+FROM\s+truck_maintenance_tickets\s+WHERE\s+id\s*=\s*p_ticket_id\s+FOR\s+UPDATE;/i);
  });

  it('enforces driver ownership against resolved profile without service_role bypass', () => {
    // Must NOT contain auth.role() <> 'service_role' bypass
    expect(sqlContent).not.toMatch(/auth\.role\(\)\s*<>\s*'service_role'/i);
    expect(sqlContent).not.toMatch(/auth\.role\(\)\s*!=\s*'service_role'/i);

    // Must compare resolved profile against ticket driver_id
    expect(sqlContent).toMatch(/v_caller_profile_id\s+IS\s+DISTINCT\s+FROM\s+v_ticket\.driver_id/i);
    expect(sqlContent).toMatch(/RAISE\s+EXCEPTION\s+'Access Denied:\s*You do not own this maintenance ticket\.';/i);
  });

  it('enforces the MAX_PHOTOS_EXCEEDED cap atomically', () => {
    expect(sqlContent).toMatch(/IF\s+v_total_count\s*>\s*p_max_photos\s+THEN\s+RAISE\s+EXCEPTION\s+'MAX_PHOTOS_EXCEEDED';/i);
  });

  it('revokes default execution privileges from PUBLIC and anon', () => {
    expect(sqlContent).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.append_maintenance_photos\s*\(\s*UUID,\s*TEXT\[\],\s*INTEGER\s*\)\s+FROM\s+PUBLIC;/i
    );
    expect(sqlContent).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.append_maintenance_photos\s*\(\s*UUID,\s*TEXT\[\],\s*INTEGER\s*\)\s+FROM\s+anon;/i
    );
  });

  it('grants execution privileges to authenticated users', () => {
    expect(sqlContent).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.append_maintenance_photos\s*\(\s*UUID,\s*TEXT\[\],\s*INTEGER\s*\)\s+TO\s+authenticated;/i
    );
  });
});

describe('append_maintenance_photos Functional Authorization & RPC Logic', () => {
  const DRIVER_PROFILE_ID = 'profile-driver-111';
  const OTHER_DRIVER_PROFILE_ID = 'profile-driver-222';
  const TICKET_ID = 'ticket-aaa-111';

  let profileMap;
  let ticketsStore;

  beforeEach(() => {
    profileMap = {
      'firebase-uid-111': DRIVER_PROFILE_ID,
      'firebase-uid-222': OTHER_DRIVER_PROFILE_ID,
    };
    ticketsStore = [
      {
        id: TICKET_ID,
        driver_id: DRIVER_PROFILE_ID,
        photo_urls: ['drivers/profile-driver-111/photo-old-1.jpg'],
      },
    ];
  });

  it('1. Authorized driver: authenticated user whose profile matches ticket driver_id succeeds', () => {
    const updated = executeAppendMaintenancePhotos({
      authUid: 'firebase-uid-111',
      profileMap,
      ticketsStore,
      ticketId: TICKET_ID,
      newPaths: ['drivers/profile-driver-111/photo-new-2.jpg'],
      maxPhotos: 3,
    });

    expect(updated.photo_urls).toEqual([
      'drivers/profile-driver-111/photo-old-1.jpg',
      'drivers/profile-driver-111/photo-new-2.jpg',
    ]);
  });

  it('2. Unauthenticated caller: no auth.uid() is rejected with Unauthorized', () => {
    expect(() =>
      executeAppendMaintenancePhotos({
        authUid: null,
        profileMap,
        ticketsStore,
        ticketId: TICKET_ID,
        newPaths: ['drivers/photo.jpg'],
      })
    ).toThrow('Unauthorized');
  });

  it('3. Non-owner driver: authenticated user whose resolved profile does not match driver_id is rejected', () => {
    expect(() =>
      executeAppendMaintenancePhotos({
        authUid: 'firebase-uid-222', // Resolves to OTHER_DRIVER_PROFILE_ID
        profileMap,
        ticketsStore,
        ticketId: TICKET_ID, // Owned by DRIVER_PROFILE_ID
        newPaths: ['drivers/photo.jpg'],
      })
    ).toThrow('Access Denied: You do not own this maintenance ticket.');
  });

  it('4. Correct RPC behavior: valid photo metadata is appended and existing photo metadata is preserved', () => {
    ticketsStore[0].photo_urls = [
      'existing/p1.jpg',
      'existing/p2.jpg',
    ];

    const updated = executeAppendMaintenancePhotos({
      authUid: 'firebase-uid-111',
      profileMap,
      ticketsStore,
      ticketId: TICKET_ID,
      newPaths: ['new/p3.jpg'],
      maxPhotos: 3,
    });

    expect(updated.photo_urls).toHaveLength(3);
    expect(updated.photo_urls[0]).toBe('existing/p1.jpg');
    expect(updated.photo_urls[1]).toBe('existing/p2.jpg');
    expect(updated.photo_urls[2]).toBe('new/p3.jpg');
  });

  it('5. Rejects with MAX_PHOTOS_EXCEEDED when exceeding the cap', () => {
    ticketsStore[0].photo_urls = [
      'existing/p1.jpg',
      'existing/p2.jpg',
    ];

    expect(() =>
      executeAppendMaintenancePhotos({
        authUid: 'firebase-uid-111',
        profileMap,
        ticketsStore,
        ticketId: TICKET_ID,
        newPaths: ['new/p3.jpg', 'new/p4.jpg'],
        maxPhotos: 3,
      })
    ).toThrow('MAX_PHOTOS_EXCEEDED');
  });

  it('6. Rejects with MAINTENANCE_TICKET_NOT_FOUND when ticket does not exist', () => {
    expect(() =>
      executeAppendMaintenancePhotos({
        authUid: 'firebase-uid-111',
        profileMap,
        ticketsStore,
        ticketId: 'nonexistent-ticket',
        newPaths: ['new/p1.jpg'],
      })
    ).toThrow('MAINTENANCE_TICKET_NOT_FOUND');
  });

  it('7. Rejects with Unauthorized when get_profile_id() cannot resolve a profile', () => {
    expect(() =>
      executeAppendMaintenancePhotos({
        authUid: 'unknown-firebase-uid',
        profileMap,
        ticketsStore,
        ticketId: TICKET_ID,
        newPaths: ['new/p1.jpg'],
      })
    ).toThrow('Unauthorized: Profile not found');
  });
});
