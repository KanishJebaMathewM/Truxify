import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), rpc: vi.fn(), signed: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({
  supabase: { storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, createSignedUrl: mocks.signed }) } },
  createUserClient: () => ({ rpc: mocks.rpc, from: () => ({ select() { return this; },
    eq() { return this; }, maybeSingle: async () => ({ data: { id: 'ticket', driver_id: 'driver', photo_urls: [] }, error: null }) }) }),
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/lib/malwareScanner.js', () => ({
  scanDocument: async () => ({ clean: true }), MalwareScanError: class extends Error {},
}));
import { uploadMaintenancePhotos } from '../../src/controllers/maintenancePhotoController.js';

const jpeg = () => ({ mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]) });
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.remove.mockResolvedValue({ error: null });
  mocks.signed.mockImplementation(async path => ({ data: { signedUrl: `https://photos.invalid/${path}` }, error: null }));
  mocks.rpc.mockResolvedValue({ error: null });
});

describe('maintenance photo upload rollback waits for pending writes', () => {
  it.each(['validation', 'storage'])('cleans a late successful upload after another file fails %s', async failure => {
    let finishUpload;
    mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve; }));
    const invalid = { mimetype: 'image/jpeg', buffer: Buffer.from('invalid image') };
    mocks.upload.mockResolvedValueOnce({ error: { message: 'second upload failed' } });
    const res = response();
    const done = uploadMaintenancePhotos({ user: { id: 'driver' }, token: 'jwt', params: { ticketId: 'ticket' },
      files: [jpeg(), failure === 'validation' ? invalid : jpeg()] }, res);
    await flush();
    const repliedBeforeUploadCompleted = res.json.mock.calls.length > 0;
    const uploadedPath = mocks.upload.mock.calls[0][0];
    finishUpload({ error: null });
    await done;
    await flush();
    expect(repliedBeforeUploadCompleted).toBe(false);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([uploadedPath]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(failure === 'validation' ? 422 : 500);
  });

  it('keeps concurrent successful uploads and appends all paths once', async () => {
    const completions = [];
    mocks.upload.mockImplementation(() => new Promise(resolve => { completions.push(resolve); }));
    const res = response();
    const done = uploadMaintenancePhotos({ user: { id: 'driver' }, token: 'jwt', params: { ticketId: 'ticket' },
      files: [jpeg(), jpeg()] }, res);
    await flush();
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    completions[1]({ error: null });
    completions[0]({ error: null });
    await done;
    const paths = mocks.upload.mock.calls.map(call => call[0]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('append_maintenance_photos', {
      p_ticket_id: 'ticket', p_new_paths: [...paths].reverse(), p_max_photos: 3,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].uploaded_count).toBe(2);
  });
});
