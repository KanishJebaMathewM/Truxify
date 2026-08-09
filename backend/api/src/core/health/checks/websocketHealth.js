import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'websocket';

function check() {
  const wsState = globalThis.__truxify_wsState;
  if (!wsState || typeof wsState !== 'object') {
    // No WebSocket server state was registered: fail closed instead of
    // reporting a server that never started as healthy.
    return { status: HealthStatus.UNHEALTHY, message: 'no_websocket_server' };
  }
  const pubSub = wsState.pubSub;
  const hasServer = Boolean(wsState.hasWebSocketServer);
  return {
    status: hasServer ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
    message: hasServer ? 'active' : 'server_not_running',
    metadata: {
      hasServer,
      hasHeartbeat: Boolean(wsState.hasWsHeartbeatInterval),
      isSchedulerActive: Boolean(wsState.isSchedulerActive),
      pubSubEnabled: Boolean(pubSub && pubSub.enabled),
      pubSubReady: Boolean(pubSub && pubSub.ready),
    },
  };
}

export default function websocketHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
