/**
 * Unit tests for backend/api/src/services/zkp/zkp.service.js
 *
 * Coverage (issue #8887 — ZKP KYC self-attestation):
 *   - mock proofs are never persisted / never recorded on-chain
 *   - the mock branch is unreachable in production
 *   - the proof path requires a server-verified document and a license number
 *     matching the OCR/DigiLocker record
 *
 * Run with: npx vitest run test/unit/zkpService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const dbMock = vi.hoisted(() => {
  const tableResults = {};
  const writes = [];

  function buildQuery(table) {
    const chain = {};
    chain.select = () => chain;
    chain.insert = (rows) => {
      writes.push({ table, type: 'insert', rows });
      return { error: null, data: rows };
    };
    chain.update = (rows) => {
      writes.push({ table, type: 'update', rows });
      return chain;
    };
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = () => Promise.resolve(tableResults[table] || { data: null, error: null });
    chain.single = () => Promise.resolve(tableResults[table] || { data: null, error: null });
    return chain;
  }

  return {
    supabase: { from: vi.fn((table) => buildQuery(table)) },
    supabaseAdmin: { from: vi.fn((table) => buildQuery(table)) },
    tableResults,
    writes,
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: dbMock.supabase,
  supabaseAdmin: dbMock.supabaseAdmin,
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

import { acquireLock, releaseLock } from '../../src/lib/redisLock.js';
import zkpService from '../../src/services/zkp/zkp.service.js';

const VERIFIED_DETAILS = {
  data: { kyc_status: 'Verified', kyc_doc_number: 'DL-1420110012345' },
  error: null,
};
const UNVERIFIED_DETAILS = {
  data: { kyc_status: 'Unverified', kyc_doc_number: null },
  error: null,
};
const NOT_KYC_VERIFIED_USER = { data: { kyc_verified: false }, error: null };

function validDriverData() {
  return {
    userId: 'user-1',
    name: 'Test Driver',
    licenseNumber: 'DL1420110012345',
    rcNumber: 'RC1234',
    insuranceNumber: 'INS5678',
    issueDate: '2020-01-01',
    expiryDate: '2030-01-01',
  };
}

describe('ZKPService self-attestation guard (issue #8887)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(dbMock.tableResults).forEach((k) => delete dbMock.tableResults[k]);
    dbMock.writes.length = 0;
    delete process.env.ZKP_MOCK;
    process.env.NODE_ENV = 'test';
    vi.mocked(acquireLock).mockResolvedValue('lock-1');
    vi.mocked(releaseLock).mockResolvedValue(undefined);
  });

  it('blocks proof generation when no server-side KYC verification exists', async () => {
    dbMock.tableResults['users'] = NOT_KYC_VERIFIED_USER;
    dbMock.tableResults['driver_details'] = { data: null, error: null };

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result.success).toBe(false);
    expect(result.code).toBe('KYC_NOT_SERVER_VERIFIED');
    expect(dbMock.writes.some((w) => w.table === 'zk_proofs')).toBe(false);
  });

  it('blocks proof generation when kyc_status is not Verified', async () => {
    dbMock.tableResults['users'] = NOT_KYC_VERIFIED_USER;
    dbMock.tableResults['driver_details'] = UNVERIFIED_DETAILS;

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result.success).toBe(false);
    expect(result.code).toBe('KYC_NOT_SERVER_VERIFIED');
    expect(result.error).toMatch(/not server-verified/i);
  });

  it('blocks proof generation when the claimed license number does not match the server-verified record', async () => {
    dbMock.tableResults['users'] = NOT_KYC_VERIFIED_USER;
    dbMock.tableResults['driver_details'] = VERIFIED_DETAILS;

    const result = await zkpService.verifyDriver({ ...validDriverData(), licenseNumber: 'AAAA1111' });

    expect(result.success).toBe(false);
    expect(result.code).toBe('KYC_NOT_SERVER_VERIFIED');
    expect(result.error).toMatch(/does not match/i);
  });

  it('allows a matching server-verified license number through to proof generation (mock), without persisting', async () => {
    dbMock.tableResults['users'] = NOT_KYC_VERIFIED_USER;
    dbMock.tableResults['driver_details'] = VERIFIED_DETAILS;

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result.success).toBe(false);
    expect(result.code).toBe('MOCK_PROOF_NOT_RECORDED');
    expect(dbMock.writes.filter((w) => w.table === 'zk_proofs')).toHaveLength(0);
    expect(dbMock.writes.filter((w) => w.table === 'users')).toHaveLength(0);
    expect(dbMock.writes.filter((w) => w.table === 'kyc_audit_logs')).toHaveLength(0);
  });

  it('does not persist mock proofs through generateZKProof directly', async () => {
    process.env.NODE_ENV = 'test';

    const result = await zkpService.generateZKProof(validDriverData());

    expect(result.isMock).toBe(true);
    expect(dbMock.writes.filter((w) => w.table === 'zk_proofs')).toHaveLength(0);
  });

  it('rejects mock proofs in production even when ZKP_MOCK is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ZKP_MOCK = 'true';

    await expect(zkpService.generateZKProof(validDriverData())).rejects.toThrow(
      /disallowed in production/i
    );
  });
});
