import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('middleware/responseSanitizer', () => {
  const mockRes = () => {
    const headers = {};
    return {
      headers,
      statusCode: 200,
      json: vi.fn(function (body) { return body; }),
      getHeader: (name) => headers[name],
      setHeader: (name, value) => { headers[name] = value; },
    };
  };
  const mockNext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes undefined values from response body', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json({ name: 'Alice', age: undefined, city: 'NYC' });
    expect(jsonSpy).toHaveBeenCalledWith({ name: 'Alice', city: 'NYC' });
    expect(mockNext).toHaveBeenCalled();
  });

  it('removes private fields from response body', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json({ name: 'Bob', _internal: 'secret', __v: 1, _debug: 'debug', password: 'hunter2' });
    expect(jsonSpy).toHaveBeenCalledWith({ name: 'Bob', password: 'hunter2' });
  });

  it('handles null body', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json(null);
    expect(jsonSpy).toHaveBeenCalledWith(null);
  });

  it('handles arrays in response body', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json([
      { name: 'Alice', _private: 'secret' },
      { name: 'Bob', __v: 2 },
    ]);
    expect(jsonSpy).toHaveBeenCalledWith([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('handles nested objects', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json({
      user: { name: 'Alice', _internal: { secret: 'data' } },
      token: 'abc123',
      _metadata: { version: '1.0' },
    });
    expect(jsonSpy).toHaveBeenCalledWith({
      user: { name: 'Alice' },
      token: 'abc123',
    });
  });

  it('handles primitive values', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    res.json('just a string');
    expect(jsonSpy).toHaveBeenCalledWith('just a string');
  });

  it('calls next()', async () => {
    const { default: sanitizer } = await import('../../src/middleware/responseSanitizer.js');
    const req = {};
    const res = mockRes();
    const jsonSpy = res.json;
    sanitizer(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
