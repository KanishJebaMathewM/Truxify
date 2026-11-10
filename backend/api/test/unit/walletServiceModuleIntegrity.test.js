/**
 * Regression test: walletService.js must be loadable and must return real
 * error/log strings.
 *
 * Two template literals in the module had lost their backticks and `${...}`
 * placeholders, so the interpolations were left as bare words:
 *
 *   throw new DomainError(400, { error: Invalid Ethereum/Polygon wallet address format: "". });
 *   logger.info([WalletService] Fetching details for wallet: );
 *
 * Neither line is valid JavaScript, so the whole file raised a SyntaxError on
 * import and the pre-existing test/unit/walletService.test.js could never load
 * the module it claimed to cover.
 *
 * The behavioural assertions below are what make this a real guard: they check
 * that the rejection message and the log line are genuine strings carrying the
 * offending address, which is what the mangled versions destroyed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
const warn = vi.fn();
const error = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info, warn, error },
}));

const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const INVALID_ADDRESS = '0x123';

let walletService;

beforeEach(async () => {
  info.mockClear();
  warn.mockClear();
  error.mockClear();
  walletService = await import('../../src/services/wallet/walletService.js');
});

describe('walletService module integrity', () => {
  it('loads without a SyntaxError', () => {
    expect(walletService).toBeTruthy();
  });

  it('exports validateWalletAddress and getWalletDetails', () => {
    expect(typeof walletService.validateWalletAddress).toBe('function');
    expect(typeof walletService.getWalletDetails).toBe('function');
  });
});

describe('validateWalletAddress', () => {
  it('returns a well-formed address unchanged', async () => {
    await expect(walletService.validateWalletAddress(VALID_ADDRESS)).resolves.toBe(VALID_ADDRESS);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 123],
    ['an empty string', ''],
  ])('rejects %s with a 400 DomainError', async (_label, input) => {
    await expect(walletService.validateWalletAddress(input)).rejects.toMatchObject({
      name: 'DomainError',
      status: 400,
    });
  });

  it('rejects a malformed address with a 400 DomainError', async () => {
    await expect(walletService.validateWalletAddress(INVALID_ADDRESS)).rejects.toMatchObject({
      name: 'DomainError',
      status: 400,
    });
  });

  it('reports the malformed address as a readable message string', async () => {
    // This is the assertion the mangled template literal could not satisfy: the
    // old source produced a syntax error, and the text it was meant to build
    // reads as bare words rather than a sentence.
    await expect(walletService.validateWalletAddress(INVALID_ADDRESS)).rejects.toThrow(
      /Invalid Ethereum\/Polygon wallet address format: "0x123"\./
    );
  });

  it('never leaves the message undefined', async () => {
    const err = await walletService
      .validateWalletAddress(INVALID_ADDRESS)
      .then(() => null, (e) => e);

    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).not.toContain('undefined');
    expect(err.payload.error).toBe(err.message);
  });
});

describe('getWalletDetails', () => {
  it('returns the validated address for the caller', async () => {
    await expect(walletService.getWalletDetails(VALID_ADDRESS)).resolves.toMatchObject({
      walletAddress: VALID_ADDRESS,
    });
  });

  it('logs the wallet address as an interpolated string', async () => {
    await walletService.getWalletDetails(VALID_ADDRESS);

    expect(info).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls[0][0];
    // The old call site passed `[WalletService] Fetching details for wallet: `
    // with nothing interpolated, so the address never reached the log.
    expect(typeof logged).toBe('string');
    expect(logged).toContain(VALID_ADDRESS);
  });

  it('validates before logging, so a bad address never reaches the log', async () => {
    await expect(walletService.getWalletDetails(INVALID_ADDRESS)).rejects.toMatchObject({
      status: 400,
    });
    expect(info).not.toHaveBeenCalled();
  });
});