import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression for #14876: a bad merge mangled maintenancePhotoController.js so
// the photo-upload loop body was duplicated, a `throw scanError;` was stranded
// outside its catch, and a later `for (const path of allPaths)` referenced an
// undefined `allPaths`. The result was a SyntaxError (`missing ) after argument
// list` / duplicate declarations) so the module could not be imported at all,
// which also broke `maintenancePhotoRoutes` (it statically imports the router
// which imports this controller).
//
// This test imports the real controller module. On the broken revision the
// dynamic import rejects with a SyntaxError; after the fix it resolves and the
// happy path returns 200 with uploaded_count/photo_urls.

vi.mock('../../src/config/db.js', () => {
  const storageObjects = [];
  const storage = {
    from(bucket) {
      return {
        upload(path, buffer, options) {
          storageObjects.push({ bucket, path, buffer, options });
          return Promise.resolve({ data: { path }, error: null });
        },
        async createSignedUrl(path, expiresIn) {
          return {
            data: { signedUrl: `https://mock-storage.example/${bucket}/${path}?expires=${expiresIn}` },
            error: null,
          };
        },
        async remove(paths) {
          for (const p of paths) {
            const idx = storageObjects.findIndex((o) => o.path === p);
            if (idx >= 0) storageObjects.splice(idx, 1);
          }
        },
      };
    },
    storage: { /* set below after from() closure is wired */ },
  };
  // `supabase.storage` must be the same object the controller reaches; the
  // controller calls `supabase.storage.from('maintenance-photos')`, so expose a
  // `.storage` whose `from` returns the same chain.
  const supabase = { storage: { from: storage.from.bind(storage) } };

  // userClient mirrors the subset the controller uses: from().select().eq().maybeSingle()
  // and .rpc().
  let ticketStore = [];
  const userClient = {
    from(table) {
      if (table === 'truck_maintenance_tickets') {
        return {
          select() {
            return this;
          },
          eq(_col, _val) {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: ticketStore[0] ?? null, error: null });
          },
        };
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc(_name, _args) {
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    supabase,
    createUserClient: () => userClient,
    firebaseAdmin: null,
    redisClient: null,
    mongoDb: null,
    __setTicketStore(rows) {
      ticketStore = rows;
    },
    __storageObjects: storageObjects,
  };
});

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/malwareScanner.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    scanDocument: vi.fn().mockResolvedValue({ clean: true, engine: 'mock' }),
  };
});

// validateDocumentBuffer is a pure function (magic-byte sniff). Let it run for
// real so the JPEG/PNG happy path is exercised end-to-end.

const { uploadMaintenancePhotos } = await import('../../src/controllers/maintenancePhotoController.js');
const dbMock = await import('../../src/config/db.js');

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x46, 0x49,
]);

function fakeRes() {
  const sent = {};
  const res = {
    status(code) {
      sent.code = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
  return { res, sent };
}

describe('maintenancePhotoController — bad-merge regression (#14876)', () => {
  beforeEach(() => {
    dbMock.__setTicketStore([
      {
        id: 'ticket-1',
        driver_id: 'driver-1',
        photo_urls: [],
      },
    ]);
    dbMock.__storageObjects.length = 0;
  });

  it('module imports without SyntaxError (regression: duplicate upload block stranded throw)', async () => {
    expect(typeof uploadMaintenancePhotos).toBe('function');
  });

  it('uploads a JPEG and returns 200 with photo_urls + uploaded_count (regression: allPaths ReferenceError)', async () => {
    const { res, sent } = fakeRes();
    await uploadMaintenancePhotos(
      {
        user: { id: 'driver-1' },
        token: 'jwt-token',
        params: { ticketId: 'ticket-1' },
        files: [{ buffer: JPEG_BYTES, mimetype: 'image/jpeg' }],
      },
      res,
    );

    expect(sent.code).toBe(200);
    expect(sent.body.success).toBe(true);
    expect(sent.body.uploaded_count).toBe(1);
    expect(sent.body.photo_urls).toHaveLength(1);
    expect(dbMock.__storageObjects.length).toBe(1);
    expect(dbMock.__storageObjects[0].bucket).toBe('maintenance-photos');
  });
});
