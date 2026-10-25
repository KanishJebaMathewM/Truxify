import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('child_process', () => {
  const exec = vi.fn();
  exec[Symbol.for('nodejs.util.promisify.custom')] = mocks.exec;
  return { exec };
});
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn() }
}));
import service from '../../../../k8s/opa/policy.service.js';

const output = (value) => JSON.stringify({
  result: [{ expressions: [{ value, text: 'data.security.allow' }] }]
});
const response = (stdout) => ({ stdout, stderr: '' });

describe('OPA CLI policy decisions', () => {
  beforeEach(() => {
    mocks.exec.mockReset();
    service.policyCache.set('security.rego', 'allow { true }');
  });

  it('accepts a true expression and does not run deny', async () => {
    mocks.exec.mockResolvedValueOnce(response(output(true)));
    const result = await service.evaluateSecurity({});
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it('returns the string members of the deny set', async () => {
    mocks.exec.mockResolvedValueOnce(response(output(false)))
      .mockResolvedValueOnce(response(output(['Privileged containers are not allowed.', 'Running as root is not allowed.'])));
    const result = await service.evaluateSecurity({});
    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual(['Privileged containers are not allowed.', 'Running as root is not allowed.']);
  });

  it.each([
    '{}', '{"result":[]}', '{"result":null}', 'null', 'not json',
    output('true'), output(1), output({ allow: true }),
    '{"result":[{"value":true}]}',
    '{"result":[{"expressions":null}]}',
    '{"result":[{"expressions":[{"value":true},{"value":false}]}]}',
    '{"result":[{"expressions":[{"value":true}]},{"expressions":[{"value":false}]}]}'
  ])('denies undefined/malformed/nonboolean/ambiguous allow result: %s', async (stdout) => {
    mocks.exec.mockResolvedValueOnce(response(stdout)).mockResolvedValueOnce(response('{}'));
    expect((await service.evaluateSecurity({})).allowed).toBe(false);
  });

  it('ignores malformed violation members', async () => {
    mocks.exec.mockResolvedValueOnce(response(output(false)))
      .mockResolvedValueOnce(response(output(['known denial', null, 42, { allow: true }])));
    expect((await service.evaluateSecurity({})).violations).toEqual(['known denial']);
  });

  it('keeps temporary input isolated per call and cleans up on CLI failure', async () => {
    const paths = [];
    mocks.exec.mockImplementation(async (command) => {
      const inputPath = command.match(/--input ([^ ]+)/)[1];
      expect(fs.existsSync(inputPath)).toBe(true);
      paths.push(inputPath);
      throw new Error('CLI unavailable');
    });
    const results = await Promise.all([service.evaluateSecurity({ a: 1 }), service.evaluateSecurity({ a: 2 })]);
    expect(new Set(paths).size).toBe(2);
    for (const inputPath of paths) expect(fs.existsSync(inputPath)).toBe(false);
    for (const result of results) expect(result.allowed).toBe(false);
  });
});
