import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OtelTracerService, otelTracer } from '../tracer.js';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('OtelTracerService', () => {
  test('generateW3cTraceparent emits a spec-shaped sampled header', () => {
    const t = new OtelTracerService();
    const tp = t.generateW3cTraceparent();
    assert.match(tp, TRACEPARENT_RE, 'version 00, 32-hex trace id, 16-hex parent id, sampled flag 01');
  });

  test('trace ids are unique across calls', () => {
    const t = new OtelTracerService();
    const ids = new Set(Array.from({ length: 200 }, () => t.generateW3cTraceparent()));
    assert.equal(ids.size, 200);
  });

  test('middleware propagates an incoming traceparent to req + res', () => {
    const t = new OtelTracerService();
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const req = { headers: { traceparent: incoming } };
    const headers = {};
    const res = { setHeader: (k, v) => (headers[k] = v) };
    let called = false;
    t.traceMiddleware(req, res, () => (called = true));
    assert.equal(req.traceparent, incoming);
    assert.equal(headers['traceparent'], incoming);
    assert.equal(called, true);
  });

  test('middleware generates a fresh traceparent when absent', () => {
    const t = new OtelTracerService();
    const req = { headers: {} };
    const headers = {};
    const res = { setHeader: (k, v) => (headers[k] = v) };
    t.traceMiddleware(req, res, () => {});
    assert.match(req.traceparent, TRACEPARENT_RE);
    assert.equal(headers['traceparent'], req.traceparent);
  });

  test('the exported singleton is an instance of the service', () => {
    assert.ok(otelTracer instanceof OtelTracerService);
  });
});
