import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'websocket';

function check() {
  const wsState = globalThis.__truxify_wsState;
  if (wsState && typeof wsState === 'object') {
    return {
      status: wsState.hasWebSocketServer ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
      metadata: {
        hasServer: Boolean(wsState.hasWebSocketServer),
        hasHeartbeat: Boolean(wsState.hasWsHeartbeatInterval),
        isSchedulerActive: Boolean(wsState.isSchedulerActive),
      },
    };
  }
  return { status: HealthStatus.HEALTHY, message: 'active' };
}

export default function websocketHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
