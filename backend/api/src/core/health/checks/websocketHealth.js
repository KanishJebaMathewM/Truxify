import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'websocket';

function check() {
  const wsState = globalThis.__truxify_wsState;
  if (!wsState || typeof wsState !== 'object') {
    // No WebSocket server state was registered: fail closed instead of
    // reporting a server that never started as healthy.
    return { status: HealthStatus.UNHEALTHY, message: 'no_websocket_server' };
  }
  return {
    status: wsState.hasWebSocketServer ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
    message: wsState.hasWebSocketServer ? 'active' : 'server_not_running',
    metadata: {
      hasServer: Boolean(wsState.hasWebSocketServer),
      hasHeartbeat: Boolean(wsState.hasWsHeartbeatInterval),
      isSchedulerActive: Boolean(wsState.isSchedulerActive),
    },
  };
}

export default function websocketHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
