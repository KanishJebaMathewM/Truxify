import logger from "../../middleware/logger.js";
import { HealthStatus, withTimeout } from "./HealthCheck.js";

/**
 * @typedef {object} ServiceHealthResult
 * @property {string} name
 * @property {string} status - 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
 * @property {string} [message]
 * @property {object} [metadata]
 * @property {number} responseTime - milliseconds
 * @property {boolean} critical
 * @property {string} timestamp - ISO 8601
 */

/**
 * @typedef {object} AggregatedHealthResponse
 * @property {string} status - 'healthy' | 'degraded' | 'unhealthy'
 * @property {string} timestamp - ISO 8601
 * @property {number} responseTime - total aggregation time in ms
 * @property {number} uptime - process.uptime()
 * @property {object} version - { node, api }
 * @property {object} memory - process.memoryUsage()
 * @property {object} services - map of service name → ServiceHealthResult
 * @property {object} summary - { total, healthy, degraded, unhealthy }
 */

/**
 * Run all registered health checks concurrently and produce a unified response.
 */
export class HealthAggregator {
  constructor() {
    /** @type {Array<{ name: string, checkFn: Function, critical: boolean, timeoutMs?: number }>} */
    this._checks = [];
  }

  /**
   * Register a health check.
   *
   * @param {string} name - Service identifier
   * @param {Function} checkFn - Async function returning ServiceHealthResult
   * @param {object} [opts]
   * @param {boolean} [opts.critical=false]
   * @param {number} [opts.timeoutMs]
   */
  register(name, checkFn, { critical = false, timeoutMs } = {}) {
    this._checks.push({ name, checkFn, critical, timeoutMs });
  }

  /**
   * Execute all registered health checks and return an aggregated response.
   *
   * @returns {Promise<AggregatedHealthResponse>}
   */
  async aggregate() {
    const start = Date.now();

    const results = await Promise.all(
      this._checks.map(async ({ name, checkFn, critical, timeoutMs }) => {
        const startTime = Date.now();

        const run = async () => {
          try {
            return await checkFn();
          } catch (err) {
            logger.error(
              `[health] Aggregator check "${name}" threw: ${err.message}`,
            );
            return {
              name,
              status: HealthStatus.UNHEALTHY,
              message: err.message,
              responseTime: Date.now() - startTime,
              critical: Boolean(critical),
              timestamp: new Date().toISOString(),
            };
          }
        };

        // Apply the registered per-check timeoutMs when set. A timed-out
        // check resolves as UNHEALTHY so aggregation always completes.
        const executed = timeoutMs ? withTimeout(run(), timeoutMs) : run();

        try {
          return await executed;
        } catch (err) {
          logger.error(
            `[health] Aggregator check "${name}" timed out: ${err.message}`,
          );
          return {
            name,
            status: HealthStatus.UNHEALTHY,
            message: err.message,
            responseTime: Date.now() - startTime,
            critical: Boolean(critical),
            timestamp: new Date().toISOString(),
          };
        }
      }),
    );

    /** @type {Record<string, ServiceHealthResult>} */
    const services = {};
    for (const result of results) {
      services[result.name] = result;
    }

    const summary = this._buildSummary(results);
    const overallStatus = this._determineOverallStatus(results);

    const totalResponseTime = Date.now() - start;

    if (overallStatus !== HealthStatus.HEALTHY) {
      logger.warn(`[health] Aggregated status: ${overallStatus}`, {
        summary,
        slowServices: results
          .filter((r) => r.responseTime > 500)
          .map((r) => `${r.name}(${r.responseTime}ms)`),
      });
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime: totalResponseTime,
      uptime: process.uptime(),
      version: {
        node: process.version,
        api: process.env.npm_package_version || "1.0.0",
      },
      memory: this._formatMemory(process.memoryUsage()),
      services,
      summary,
    };
  }

  /**
   * Determine the overall status from individual results.
   * Critical service failures → unhealthy.
   * Non-critical failures → degraded.
   */
  _determineOverallStatus(results) {
    const criticalUnhealthy = results.some(
      (r) => r.critical && r.status === HealthStatus.UNHEALTHY,
    );
    if (criticalUnhealthy) return HealthStatus.UNHEALTHY;

    const hasDegraded = results.some(
      (r) =>
        r.status === HealthStatus.DEGRADED ||
        r.status === HealthStatus.UNHEALTHY,
    );
    if (hasDegraded) return HealthStatus.DEGRADED;

    return HealthStatus.HEALTHY;
  }

  _buildSummary(results) {
    return {
      total: results.length,
      healthy: results.filter((r) => r.status === HealthStatus.HEALTHY).length,
      degraded: results.filter((r) => r.status === HealthStatus.DEGRADED)
        .length,
      unhealthy: results.filter((r) => r.status === HealthStatus.UNHEALTHY)
        .length,
    };
  }

  _formatMemory(mem) {
    return {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      unit: "MB",
    };
  }
}
