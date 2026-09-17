import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import { requireDaoAuth } from '../middleware/daoAuth.js';

// Mock dependencies
vi.mock('../config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { wallet_address: '0x123...' }, error: null })
  }
}));

vi.mock('../api/src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

describe('DAO Authentication Middleware (#13888)', () => {
  let req, res, next;
  const JWT_SECRET = 'truxify-dao-secret';
  const USER_ID = 'user-123';
  const USER_WALLET = '0xAbC1234567890123456789012345678901234567';
  const OTHER_WALLET = '0x9999999999999999999999999999999999999999';

  beforeEach(() => {
    req = {
      headers: {},
      body: {}
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false
    };
    next = vi.fn();
    
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function generateToken(wallet) {
    return jwt.sign({ sub: USER_ID, wallet_address: wallet, role: 'member' }, JWT_SECRET);
  }

  it('should reject requests without Authorization header', async () => {
    req.body.voterAddress = USER_WALLET;
    const middleware = requireDaoAuth('vote');
    
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access Denied. No token provided.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject requests with invalid JWT', async () => {
    req.headers.authorization = 'Bearer invalid-token';
    req.body.voterAddress = USER_WALLET;
    const middleware = requireDaoAuth('vote');
    
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow action if authenticated user wallet matches target address', async () => {
    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.body.voterAddress = USER_WALLET;
    const middleware = requireDaoAuth('vote');
    
    await middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(req.verifiedSigner).toBe(USER_WALLET.toLowerCase());
  });

  it('should reject action if user tries to impersonate another address without signature', async () => {
    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.body.voterAddress = OTHER_WALLET; // Trying to vote as someone else
    const middleware = requireDaoAuth('vote');
    
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('Forbidden: You can only act on behalf of your own registered wallet')
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow impersonation if valid EIP-191 signature is provided', async () => {
    // Setup: User A is authenticated, but wants to vote on behalf of User B (hardware wallet)
    const signer = new ethers.Wallet('0x' + '1'.repeat(64)); // Private key for OTHER_WALLET
    const message = `Truxify DAO Action: vote\nUser: ${USER_ID}\nNonce: 12345`;
    const signature = await signer.signMessage(message);

    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.headers['x-dao-signature'] = signature;
    req.headers['x-dao-message'] = message;
    req.body.voterAddress = OTHER_WALLET; // The address the signature proves ownership of
    
    const middleware = requireDaoAuth('vote');
    await middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(req.verifiedSigner).toBe(OTHER_WALLET.toLowerCase());
  });

  it('should reject if signature recovers to a different address than claimed', async () => {
    const signer = new ethers.Wallet('0x' + '2'.repeat(64)); // Different private key
    const message = `Truxify DAO Action: vote\nUser: ${USER_ID}\nNonce: 12345`;
    const signature = await signer.signMessage(message);

    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.headers['x-dao-signature'] = signature;
    req.headers['x-dao-message'] = message;
    req.body.voterAddress = OTHER_WALLET; // Claiming to be OTHER_WALLET, but signature is from someone else
    
    const middleware = requireDaoAuth('vote');
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature: recovered address does not match claimed address.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should enforce correct message format to prevent replay attacks', async () => {
    const signer = new ethers.Wallet('0x' + '1'.repeat(64));
    const badMessage = `Hello world`; // Missing DAO context
    const signature = await signer.signMessage(badMessage);

    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.headers['x-dao-signature'] = signature;
    req.headers['x-dao-message'] = badMessage;
    req.body.voterAddress = OTHER_WALLET;
    
    const middleware = requireDaoAuth('vote');
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should extract proposer address for propose action type', async () => {
    req.headers.authorization = `Bearer ${generateToken(USER_WALLET)}`;
    req.body.proposer = USER_WALLET;
    const middleware = requireDaoAuth('propose');
    
    await middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(req.verifiedSigner).toBe(USER_WALLET.toLowerCase());
  });
});
