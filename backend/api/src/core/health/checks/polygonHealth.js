import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'polygon';

async function check() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `RPC probe failed with HTTP ${res.status}`,
        metadata: { rpcUrl: rpcUrl.replace(/\/\/.*@/, '//***@') },
      };
    }
    return {
      status: HealthStatus.HEALTHY,
      metadata: { rpcUrl: rpcUrl.replace(/\/\/.*@/, '//***@') },
    };
  } catch (err) {
    return {
      status: HealthStatus.UNHEALTHY,
      message: err.name === 'AbortError' ? 'RPC timeout (5000ms exceeded)' : err.message,
      metadata: { rpcUrl: rpcUrl.replace(/\/\/.*@/, '//***@') },
    };
  }
}

export default function polygonHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
