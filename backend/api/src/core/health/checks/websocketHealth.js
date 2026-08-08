import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'websocket';

function check() {
  const wsState = globalThis.__truxify_wsState;
  if (wsState && typeof wsState === 'object') {
    const pubSub = wsState.pubSub;
    return {
      status: wsState.hasWebSocketServer ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
      metadata: {
        hasServer: Boolean(wsState.hasWebSocketServer),
        hasHeartbeat: Boolean(wsState.hasWsHeartbeatInterval),
        isSchedulerActive: Boolean(wsState.isSchedulerActive),
        pubSubEnabled: Boolean(pubSub && pubSub.enabled),
        pubSubReady: Boolean(pubSub && pubSub.ready),
      },
    };
  }
  return { status: HealthStatus.DEGRADED, message: 'websocket_not_initialized' };
}

export default function websocketHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
