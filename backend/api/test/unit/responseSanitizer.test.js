import { describe, it, expect, vi } from 'vitest';
import responseSanitizer from '../../src/middleware/responseSanitizer.js';

function makeResMock() {
  const res = {
    _data: null,
  };
  res.json = vi.fn(function (body) {
    res._data = body;
    return res;
  });
  return res;
}

describe('responseSanitizer', () => {
  it('calls next() and wraps res.json', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('strips _internal field from response body', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    res.json({ id: '1', name: 'test', _internal: 'secret' });

    expect(res._data).toEqual({ id: '1', name: 'test' });
    expect(res._data._internal).toBeUndefined();
  });

  it('strips __v field from response body', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    res.json({ id: '1', __v: 3 });

    expect(res._data).toEqual({ id: '1' });
    expect(res._data.__v).toBeUndefined();
  });

  it('strips _debug, _metadata, and _private fields', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    res.json({ id: '2', _debug: true, _metadata: {}, _private: 'x' });

    expect(res._data).toEqual({ id: '2' });
  });

  it('handles arrays of objects by sanitizing each element', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    res.json([
      { id: '1', _internal: 'a' },
      { id: '2', __v: 5 },
    ]);

    expect(res._data).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('passes through primitive values unchanged', () => {
    const req = {};
    const res = makeResMock();
    const next = vi.fn();

    responseSanitizer(req, res, next);
    res.json('hello');

    expect(res._data).toBe('hello');
  });
});
