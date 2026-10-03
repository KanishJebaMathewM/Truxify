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
  const statsResults = {};
  const writes = [];

  function buildQuery(table) {
    const chain = {};
    let isCountQuery = false;
    chain.select = (_columns, options) => {
      isCountQuery = options?.count === 'exact' && options?.head === true;
      return chain;
    };
    chain.insert = (rows) => {
      writes.push({ table, type: 'insert', rows });
      return { error: null, data: rows };
    };
    chain.update = (rows) => {
      writes.push({ table, type: 'update', rows });
      return chain;
    };
    chain.eq = (_column, value) => {
      if (isCountQuery) {
        return Promise.resolve(statsResults[String(value)] || { count: 0, error: null });
      }
      return chain;
    };
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
    statsResults,
    writes,
  };
});

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
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

describe('ZKPService asynchronous pipeline', () => {
  const walletAddress = '0x00000000000000000000000000000000000000a1';
  const transactionHash = '0x' + 'a'.repeat(64);
  const proof = {
    a: ['1', '2'],
    b: [['3', '4'], ['5', '6']],
    c: ['7', '8'],
    input: ['9', '10'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    Object.keys(dbMock.tableResults).forEach((key) => delete dbMock.tableResults[key]);
    Object.keys(dbMock.statsResults).forEach((key) => delete dbMock.statsResults[key]);
    dbMock.writes.length = 0;
    process.env.NODE_ENV = 'test';
    delete process.env.ZKP_MOCK;
    zkpService.contract = null;
    vi.mocked(acquireLock).mockResolvedValue('lock-1');
    vi.mocked(releaseLock).mockResolvedValue(undefined);
  });

  it('verifyKYCOnChain submits the proof and updates the profile', async () => {
    const wait = vi.fn().mockResolvedValue({ hash: transactionHash, blockNumber: 42 });
    const verifyKYC = vi.fn().mockResolvedValue({ wait });
    zkpService.contract = { verifyKYC };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    const result = await zkpService.verifyKYCOnChain('user-1', proof);

    expect(verifyKYC).toHaveBeenCalledWith(
      proof.a,
      proof.b,
      proof.c,
      proof.input,
      walletAddress,
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      transactionHash,
      blockNumber: 42,
    });
    expect(dbMock.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'profiles',
        type: 'update',
        rows: expect.objectContaining({
          kyc_verified: true,
          kyc_tx_hash: transactionHash,
        }),
      }),
    ]));
  });

  it('verifyKYCOnChain rejects when the contract is unavailable', async () => {
    await expect(zkpService.verifyKYCOnChain('user-1', proof))
      .rejects.toThrow(/not configured/i);
  });

  it('verifyKYCOnChain rejects when the profile is missing', async () => {
    const verifyKYC = vi.fn();
    zkpService.contract = { verifyKYC };
    dbMock.tableResults.profiles = { data: null, error: null };

    await expect(zkpService.verifyKYCOnChain('missing-user', proof))
      .rejects.toThrow('User not found');
    expect(verifyKYC).not.toHaveBeenCalled();
  });

  it('verifyKYCOnChain propagates blockchain errors', async () => {
    const verifyKYC = vi.fn().mockRejectedValue(new Error('transaction rejected'));
    zkpService.contract = { verifyKYC };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    await expect(zkpService.verifyKYCOnChain('user-1', proof))
      .rejects.toThrow('transaction rejected');
  });

  it('isVerified returns the on-chain result for a known wallet', async () => {
    const isVerified = vi.fn().mockResolvedValue(true);
    zkpService.contract = { isVerified };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    await expect(zkpService.isVerified('user-1')).resolves.toBe(true);
    expect(isVerified).toHaveBeenCalledWith(walletAddress);
  });

  it('isVerified returns false when the service is disabled', async () => {
    zkpService.contract = null;
    await expect(zkpService.isVerified('user-1')).resolves.toBe(false);
  });

  it('isVerified returns false when no wallet profile exists', async () => {
    zkpService.contract = { isVerified: vi.fn() };
    dbMock.tableResults.profiles = { data: null, error: null };

    await expect(zkpService.isVerified('missing-user')).resolves.toBe(false);
    expect(zkpService.contract.isVerified).not.toHaveBeenCalled();
  });

  it('isVerified converts contract failures into a false result', async () => {
    zkpService.contract = { isVerified: vi.fn().mockRejectedValue(new Error('RPC down')) };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    await expect(zkpService.isVerified('user-1')).resolves.toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Verification check failed:',
      expect.any(Error),
    );
  });

  it('isVerifiedInDb returns true only for a true database flag', async () => {
    dbMock.tableResults.profiles = { data: { kyc_verified: true }, error: null };
    await expect(zkpService.isVerifiedInDb('user-1')).resolves.toBe(true);

    dbMock.tableResults.profiles = { data: { kyc_verified: false }, error: null };
    await expect(zkpService.isVerifiedInDb('user-1')).resolves.toBe(false);
  });

  it('isVerifiedInDb fails closed on missing data or database errors', async () => {
    dbMock.tableResults.profiles = { data: null, error: { message: 'not found' } };
    await expect(zkpService.isVerifiedInDb('user-1')).resolves.toBe(false);

    dbMock.tableResults.profiles = { data: null, error: null };
    await expect(zkpService.isVerifiedInDb('user-1')).resolves.toBe(false);
  });

  it('assertServerVerified accepts a normalized matching license number', async () => {
    dbMock.tableResults.driver_details = {
      data: { kyc_status: 'Verified', kyc_doc_number: 'DL-1420/110012345' },
      error: null,
    };

    await expect(zkpService.assertServerVerified('user-1', {
      licenseNumber: 'dl 1420-110012345',
    })).resolves.toEqual({ ok: true });
  });

  it('assertServerVerified rejects a missing record', async () => {
    dbMock.tableResults.driver_details = { data: null, error: null };

    await expect(zkpService.assertServerVerified('user-1', validDriverData()))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/No KYC verification/) });
  });

  it('assertServerVerified rejects an unverified record', async () => {
    dbMock.tableResults.driver_details = {
      data: { kyc_status: 'Pending', kyc_doc_number: 'DL123' },
      error: null,
    };

    await expect(zkpService.assertServerVerified('user-1', { licenseNumber: 'DL123' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/not server-verified/) });
  });

  it('assertServerVerified rejects a document-number mismatch', async () => {
    dbMock.tableResults.driver_details = {
      data: { kyc_status: 'Verified', kyc_doc_number: 'DL123' },
      error: null,
    };

    await expect(zkpService.assertServerVerified('user-1', { licenseNumber: 'DL999' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/does not match/) });
  });

  it('getDocumentHash returns the contract hash for a known wallet', async () => {
    const documentHash = '0x' + 'b'.repeat(64);
    const getDocumentHash = vi.fn().mockResolvedValue(documentHash);
    zkpService.contract = { getDocumentHash };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    await expect(zkpService.getDocumentHash('user-1')).resolves.toBe(documentHash);
    expect(getDocumentHash).toHaveBeenCalledWith(walletAddress);
  });

  it('getDocumentHash returns null when disabled or the profile is absent', async () => {
    zkpService.contract = null;
    await expect(zkpService.getDocumentHash('user-1')).resolves.toBeNull();

    zkpService.contract = { getDocumentHash: vi.fn() };
    dbMock.tableResults.profiles = { data: null, error: null };
    await expect(zkpService.getDocumentHash('missing-user')).resolves.toBeNull();
  });

  it('getDocumentHash fails closed when the contract call throws', async () => {
    zkpService.contract = {
      getDocumentHash: vi.fn().mockRejectedValue(new Error('RPC failure')),
    };
    dbMock.tableResults.profiles = { data: { wallet_address: walletAddress }, error: null };

    await expect(zkpService.getDocumentHash('user-1')).resolves.toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Document hash fetch failed:',
      expect.any(Error),
    );
  });

  it('storeProof writes proof and public signals to the proof ledger', async () => {
    const proofData = { proof: { a: ['1'] }, publicSignals: ['signal-1'] };

    await zkpService.storeProof('user-1', proofData);

    expect(dbMock.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'zk_proofs',
        type: 'insert',
        rows: [expect.objectContaining({
          user_id: 'user-1',
          proof: proofData.proof,
          public_signals: proofData.publicSignals,
        })],
      }),
    ]));
  });

  it('logVerification records the successful transaction in the audit log', async () => {
    await zkpService.logVerification('user-1', { transactionHash });

    expect(dbMock.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'kyc_audit_logs',
        type: 'insert',
        rows: [expect.objectContaining({
          user_id: 'user-1',
          action: 'KYC_VERIFICATION',
          status: 'SUCCESS',
          tx_hash: transactionHash,
        })],
      }),
    ]));
  });

  it('getVerificationStats combines verified and unverified counts', async () => {
    dbMock.statsResults['true'] = { count: 7, error: null };
    dbMock.statsResults['false'] = { count: 3, error: null };

    await expect(zkpService.getVerificationStats()).resolves.toEqual({
      totalVerified: 7,
      totalUnverified: 3,
      total: 10,
    });
  });

  it('getVerificationStats propagates a verified-count database error', async () => {
    dbMock.statsResults['true'] = { count: null, error: new Error('stats unavailable') };

    await expect(zkpService.getVerificationStats()).rejects.toThrow('stats unavailable');
  });

  it('verifyDriver returns an idempotent result for an already verified user', async () => {
    dbMock.tableResults.profiles = { data: { kyc_verified: true }, error: null };

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result).toEqual({
      success: true,
      alreadyVerified: true,
      verified: true,
      message: 'User is already KYC-verified.',
    });
    expect(acquireLock).toHaveBeenCalledWith('zkp:verify:user-1', expect.any(Number));
    expect(releaseLock).toHaveBeenCalledWith('zkp:verify:user-1', 'lock-1');
  });

  it('verifyDriver returns a conflict when another verification holds the lock', async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(null);

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result).toMatchObject({ success: false, conflict: true });
    expect(releaseLock).toHaveBeenCalledWith('zkp:verify:user-1', null);
  });

  it('verifyDriver releases the lock after a successful real verification', async () => {
    dbMock.tableResults.profiles = { data: { kyc_verified: false }, error: null };
    dbMock.tableResults.driver_details = VERIFIED_DETAILS;
    const proofResult = { proof, publicSignals: ['signal'], isMock: false };
    const onChainResult = { success: true, transactionHash, blockNumber: 9 };
    vi.spyOn(zkpService, 'generateZKProof').mockResolvedValue(proofResult);
    vi.spyOn(zkpService, 'verifyKYCOnChain').mockResolvedValue(onChainResult);
    vi.spyOn(zkpService, 'logVerification').mockResolvedValue(undefined);

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result).toEqual({
      success: true,
      proof: proofResult,
      onChain: onChainResult,
      verified: true,
    });
    expect(zkpService.verifyKYCOnChain).toHaveBeenCalledWith('user-1', proof);
    expect(zkpService.logVerification).toHaveBeenCalledWith('user-1', onChainResult);
    expect(releaseLock).toHaveBeenCalledWith('zkp:verify:user-1', 'lock-1');
  });

  it('verifyDriver returns a safe failure and releases the lock on errors', async () => {
    dbMock.tableResults.profiles = { data: { kyc_verified: false }, error: null };
    dbMock.tableResults.driver_details = VERIFIED_DETAILS;
    vi.spyOn(zkpService, 'generateZKProof').mockRejectedValue(new Error('proof failed'));

    const result = await zkpService.verifyDriver(validDriverData());

    expect(result).toEqual({ success: false, error: 'proof failed' });
    expect(releaseLock).toHaveBeenCalledWith('zkp:verify:user-1', 'lock-1');
  });
});
