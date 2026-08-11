import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'polygon';
const PROBE_TIMEOUT_MS = 4000;

async function probeRpc(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`RPC error: ${payload.error.message || payload.error.code}`);
  }
  if (payload.result === undefined || payload.result === null) {
    throw new Error('RPC returned no block number');
  }

  return payload.result;
}

function redactUrl(rpcUrl) {
  return rpcUrl.replace(/\/\/.*@/, '//***@');
}

function check() {
  const rpcUrl = process.env.POLYGON_RPC_URL;

  if (!rpcUrl) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }

  return probeRpc(rpcUrl)
    .then((blockNumber) => ({
      status: HealthStatus.HEALTHY,
      message: 'reachable',
      metadata: {
        rpcUrl: redactUrl(rpcUrl),
        blockNumber,
      },
    }))
    .catch((err) => ({
      status: HealthStatus.UNHEALTHY,
      message: `configured_but_unreachable: ${err.message}`,
      metadata: {
        rpcUrl: redactUrl(rpcUrl),
      },
    }));
}

export default function polygonHealth(opts) {
  return executeCheck(NAME, check, { critical: false, timeoutMs: PROBE_TIMEOUT_MS + 1000, ...opts });
}
