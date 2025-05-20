// project/src/health-checker.ts
import http from "http";
import https from "https";
import { ContainerInfo } from "dockerode";
import { IContainerStatusItem } from "@interfaces/watcher";
import { serverListState } from "./state";
import { docker } from "./config";
import { logger } from "./util";

/**
 * Health check result for a single upstream server
 */
interface UpstreamHealth {
  serverName: string;
  endpoint: string;
  healthy: boolean;
  responseTime?: number;
  statusCode?: number;
  error?: string;
  lastChecked: string;
  containerStatus?: string;
  details?: Record<string, any>;
}

/**
 * Extended health check issues
 */
interface HealthIssues {
  unreachableServers: string[];
  missingRequiredServers: string[];
  unhealthyContainers: Array<{
    id: string;
    name: string;
    status: string;
    reason?: string;
  }>;
  nginxConfigIssues: string[];
  errorDetails: Record<string, string>;
}

/**
 * Overall health check results with detailed status
 */
interface HealthCheckResult {
  upstreams: UpstreamHealth[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    healthyPercentage: number;
    overallStatus: "healthy" | "degraded" | "critical";
  };
  requiredServersStatus: {
    total: number;
    available: number;
    missing: string[];
    healthy: boolean;
  };
  containerHealthStatus: {
    total: number;
    healthy: number;
    unhealthy: number;
    restarting: number;
  };
  nginxStatus: {
    configValid: boolean;
    errorMessage?: string;
  };
  issues: HealthIssues;
}

/**
 * Check types definition
 */
export type CheckType =
  | "http"
  | "containerStatus"
  | "requiredServer"
  | "nginxConfig";

/**
 * Parse required servers from environment variable
 * @returns Array of required server names
 */
export const getRequiredServers = (): string[] => {
  const requiredServersEnv = process.env.REQUIRED_SERVERS || "";
  if (!requiredServersEnv) {
    return [];
  }

  // Parse comma-separated list of required servers
  return requiredServersEnv
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server.length > 0);
};

/**
 * Check if a container is healthy based on Docker health check
 * @param containerId - Docker container ID
 * @returns Promise with container health status
 */
export const checkContainerHealth = async (
  containerId: string
): Promise<{
  healthy: boolean;
  status: string;
  exitCode?: number;
  error?: string;
  name?: string;
  restarts?: number;
  startedAt?: string;
  health?: {
    status?: string;
    failingStreak?: number;
    log?: Array<{ output: string; exitCode: number; timestamp: string }>;
  };
}> => {
  try {
    // Get container details
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    // Extract container details
    const name = info.Name;
    const status = info.State.Status;
    const exitCode = info.State.ExitCode;
    const startedAt = info.State.StartedAt;
    const restarts = info.RestartCount || 0;

    // Default to running status check
    let healthy = status === "running";
    let error: string | undefined;

    // Check Docker health check if available
    const healthStatus = info.State.Health?.Status;
    const healthLog = info.State.Health?.Log;
    const failingStreak = info.State.Health?.FailingStreak;

    if (healthStatus) {
      healthy = healthStatus === "healthy";

      // If unhealthy, get latest health check log
      if (!healthy && healthLog && healthLog.length > 0) {
        const latestLog = healthLog[healthLog.length - 1];
        error = latestLog.Output.trim();
      }
    } else if (status !== "running") {
      // Container is not running and has no health check
      healthy = false;

      if (status === "exited") {
        if (exitCode !== 0) {
          error = `Container exited with code ${exitCode}`;
        } else {
          error = "Container exited";
        }
      } else {
        error = `Container status: ${status}`;
      }
    }

    // Return comprehensive health information
    return {
      healthy,
      status: healthStatus || status,
      exitCode,
      error,
      name,
      restarts,
      startedAt,
      health: healthStatus
        ? {
            status: healthStatus,
            failingStreak,
            log: healthLog?.map(({ Output, ExitCode, End }) => ({
              output: Output.trim(),
              exitCode: ExitCode,
              timestamp: End,
            })),
          }
        : undefined,
    };
  } catch (error: any) {
    logger.error(`Failed to check container health: ${containerId}`, {
      operation: "checkContainerHealth",
      containerId,
      error: error.message,
    });

    return {
      healthy: false,
      status: "unknown",
      error: error.message,
    };
  }
};

/**
 * Performs HTTP(S) request to check upstream server health
 * @param endpoint - Server endpoint in format ip:port
 * @param secure - Whether to use HTTPS
 * @param timeout - Request timeout in ms
 * @param path - Health check path
 * @returns Promise with health check result
 */
const checkEndpoint = async (
  endpoint: string,
  secure: boolean = false,
  timeout: number = 5000,
  path: string = "/status"
): Promise<{
  healthy: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
}> => {
  return new Promise((resolve) => {
    // Set a start time for response time measurement
    const startTime = Date.now();

    // Parse the endpoint
    const [host, portStr] = endpoint.split(":");
    const port = parseInt(portStr || "80", 10);

    // Create the request options
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: "GET",
      timeout: timeout,
      headers: {
        "User-Agent": "nginx-proxy-watch-health-checker",
        Host: "health.check",
      },
      rejectUnauthorized: false, // Allow self-signed certificates
    };

    // Choose HTTP or HTTPS module
    const requester = secure ? https : http;

    // Create the request
    const req = requester.request(options, (res) => {
      const responseTime = Date.now() - startTime;

      // Consume response data to free up memory
      res.resume();

      // Consider 2xx and 3xx status codes as healthy
      const statusCode = res.statusCode || 0;
      const healthy = statusCode >= 200 && statusCode < 400;

      resolve({
        healthy,
        statusCode,
        responseTime,
        error: healthy ? undefined : `Unhealthy status code: ${statusCode}`,
      });
    });

    // Handle errors
    req.on("error", (error) => {
      const responseTime = Date.now() - startTime;
      resolve({
        healthy: false,
        responseTime,
        error: error.message,
      });
    });

    // Handle timeout
    req.on("timeout", () => {
      req.destroy();
      const responseTime = Date.now() - startTime;
      resolve({
        healthy: false,
        responseTime,
        error: `Timeout after ${timeout}ms`,
      });
    });

    // End the request
    req.end();
  });
};

// project/src/health-checker.ts

/**
 * Enhanced required servers check with container existence verification
 * @param requiredServers - List of required server names
 * @param serverList - Current server list
 * @returns Promise with detailed check results
 */
export const checkRequiredServers = async (
  requiredServers: string[],
  serverList: Record<string, IContainerStatusItem>
): Promise<{
  healthy: boolean;
  total: number;
  available: number;
  missing: string[];
  unhealthyContainers: Array<{
    serverName: string;
    containerId: string;
    status: string;
    reason: string;
  }>;
}> => {
  if (requiredServers.length === 0) {
    return {
      healthy: true,
      total: 0,
      available: 0,
      missing: [],
      unhealthyContainers: [],
    };
  }

  const serverNames = new Set(Object.keys(serverList));
  const missing: string[] = [];
  const unhealthyContainers: Array<{
    serverName: string;
    containerId: string;
    status: string;
    reason: string;
  }> = [];

  // Find missing required servers by name
  for (const server of requiredServers) {
    if (!serverNames.has(server)) {
      missing.push(server);
      logger.warn(`Required server missing: ${server}`, {
        operation: "checkRequiredServers",
        server,
      });
    }
  }

  // For servers that do exist by name, check if they have valid containers
  const containerChecks = await Promise.all(
    requiredServers
      .filter((server) => serverNames.has(server))
      .map(async (server) => {
        const serverConfig = serverList[server];

        // Check if server has any network entries
        if (!serverConfig.network || serverConfig.network.length === 0) {
          missing.push(server);
          logger.warn(`Required server has no network entries: ${server}`, {
            operation: "checkRequiredServers",
            server,
          });
          return null;
        }

        // Check each network entry has container and valid IP
        let hasValidContainer = false;

        for (const network of serverConfig.network) {
          // Skip entries without container ID
          if (!network.dockerId) continue;

          try {
            // Check container exists and is healthy
            const containerHealth = await checkContainerHealth(
              network.dockerId
            );

            if (containerHealth.healthy) {
              hasValidContainer = true;
              // No need to check other containers if one is healthy
              break;
            } else {
              // Track unhealthy containers
              unhealthyContainers.push({
                serverName: server,
                containerId: network.dockerId,
                status: containerHealth.status,
                reason:
                  containerHealth.error ||
                  `Container unhealthy: ${containerHealth.status}`,
              });

              logger.warn(
                `Required server container unhealthy: ${server} (${network.dockerId})`,
                {
                  operation: "checkRequiredServers",
                  server,
                  containerId: network.dockerId,
                  status: containerHealth.status,
                  error: containerHealth.error,
                }
              );
            }
          } catch (error: any) {
            logger.error(
              `Error checking container health: ${network.dockerId}`,
              {
                operation: "checkRequiredServers",
                server,
                containerId: network.dockerId,
                error: error.message,
              }
            );

            // Track error as unhealthy container
            unhealthyContainers.push({
              serverName: server,
              containerId: network.dockerId,
              status: "error",
              reason: `Error checking container: ${error.message}`,
            });
          }
        }

        // If no valid container found for this server, mark as missing
        if (!hasValidContainer) {
          missing.push(server);
        }

        return null;
      })
  );

  // Final health status calculation
  const available = requiredServers.length - missing.length;
  const healthy = missing.length === 0;

  return {
    healthy,
    total: requiredServers.length,
    available,
    missing,
    unhealthyContainers,
  };
};

/**
 * Check Nginx configuration syntax
 * @returns Promise with check result
 */
export const checkNginxConfig = async (): Promise<{
  valid: boolean;
  error?: string;
}> => {
  return new Promise((resolve) => {
    const { exec } = require("child_process");

    exec("nginx -t", (error: any, stdout: string, stderr: string) => {
      if (error) {
        logger.error(`Nginx configuration test failed`, {
          operation: "nginx_config_test",
          error: error.message,
          stderr,
        });

        resolve({
          valid: false,
          error: stderr || error.message,
        });
      } else {
        logger.debug(`Nginx configuration test passed`, {
          operation: "nginx_config_test",
        });

        resolve({ valid: true });
      }
    });
  });
};

/**
 * Check health of all upstream servers with comprehensive checks
 * @param options - Health check options
 * @returns Promise with detailed health check results
 */
export const checkUpstreamHealth = async (
  options: {
    httpCheckPath?: string;
    httpTimeout?: number;
    checkTypes?: CheckType[];
  } = {}
): Promise<HealthCheckResult> => {
  // Set default options
  const {
    httpCheckPath = "/status",
    httpTimeout = 5000,
    checkTypes = ["http", "containerStatus", "requiredServer", "nginxConfig"],
  } = options;

  // Get current server list
  const serverList = serverListState.get();

  // Get required servers list
  const requiredServers = getRequiredServers();

  // Initialize results
  const upstreams: UpstreamHealth[] = [];
  const issues: HealthIssues = {
    unreachableServers: [],
    missingRequiredServers: [],
    unhealthyContainers: [],
    nginxConfigIssues: [],
    errorDetails: {},
  };

  // Initialize container health status
  const containerHealth = {
    total: 0,
    healthy: 0,
    unhealthy: 0,
    restarting: 0,
  };

  // Check required servers
  const requiredServersCheck = await checkRequiredServers(
    requiredServers,
    serverList
  );
  issues.missingRequiredServers = requiredServersCheck.missing;

  // Check nginx config if requested
  let nginxConfigCheck: { valid: boolean; error?: string } = {
    valid: true,
    error: undefined,
  };
  if (checkTypes.includes("nginxConfig")) {
    nginxConfigCheck = await checkNginxConfig();
    if (!nginxConfigCheck.valid && nginxConfigCheck.error) {
      issues.nginxConfigIssues.push(nginxConfigCheck.error);
    }
  }

  requiredServersCheck.unhealthyContainers.forEach((container) => {
    if (
      !issues.unhealthyContainers.some((c) => c.id === container.containerId)
    ) {
      issues.unhealthyContainers.push({
        id: container.containerId,
        name: container.serverName,
        status: container.status,
        reason: container.reason,
      });
    }
  });

  // Check each server
  const checkPromises = Object.values(serverList).map(
    async (server: IContainerStatusItem) => {
      // For each network endpoint in the server
      for (const network of server.network) {
        if (!network.ip || !network.dockerId) {
          continue; // Skip if no IP or dockerId
        }

        // Initialize result
        const result: UpstreamHealth = {
          serverName: server.serverName,
          endpoint: network.ip,
          healthy: true, // Assume healthy until proven otherwise
          lastChecked: new Date().toISOString(),
          details: {},
        };

        // Check container health if requested
        if (checkTypes.includes("containerStatus")) {
          containerHealth.total++;

          try {
            const containerHealthResult = await checkContainerHealth(
              network.dockerId
            );
            result.containerStatus = containerHealthResult.status;
            result.details = result.details || {};
            result.details.container = containerHealthResult;

            // Update health status based on container health
            if (!containerHealthResult.healthy) {
              result.healthy = false;
              result.error = `Container unhealthy: ${containerHealthResult.status}`;

              if (containerHealthResult.error) {
                result.error += ` - ${containerHealthResult.error}`;
              }

              // Track unhealthy containers
              issues.unhealthyContainers.push({
                id: network.dockerId,
                name: containerHealthResult.name || "unknown",
                status: containerHealthResult.status,
              });

              // Update container health counts
              if (containerHealthResult.status === "restarting") {
                containerHealth.restarting++;
              } else {
                containerHealth.unhealthy++;
              }
            } else {
              containerHealth.healthy++;
            }
          } catch (error: any) {
            // Handle unexpected errors in container health check
            result.healthy = false;
            result.error = `Failed to check container health: ${error.message}`;
            containerHealth.unhealthy++;

            logger.error(
              `Error checking container health: ${network.dockerId}`,
              {
                operation: "health_check",
                containerId: network.dockerId,
                error: error.message,
              }
            );
          }
        }

        // Perform HTTP health check if requested
        if (checkTypes.includes("http")) {
          try {
            const health = await checkEndpoint(
              network.ip,
              server.https,
              httpTimeout,
              httpCheckPath
            );

            // Update result with HTTP check details
            result.responseTime = health.responseTime;
            result.statusCode = health.statusCode;
            result.details = result.details || {};
            result.details.http = {
              statusCode: health.statusCode,
              responseTime: health.responseTime,
            };

            // If HTTP check fails, update health status
            if (!health.healthy) {
              result.healthy = false;
              result.error = health.error || "HTTP check failed";

              // Track unreachable servers
              issues.unreachableServers.push(
                `${server.serverName} (${network.ip})`
              );
              issues.errorDetails[`${server.serverName}-${network.ip}`] =
                health.error || "Unknown HTTP error";

              logger.warn(
                `Unhealthy upstream detected: ${server.serverName} (${network.ip})`,
                {
                  operation: "health_check",
                  serverName: server.serverName,
                  endpoint: network.ip,
                  error: health.error,
                }
              );
            }
          } catch (error: any) {
            // Handle unexpected errors in HTTP health check
            result.healthy = false;
            result.error = `HTTP check error: ${error.message}`;

            // Track error
            issues.unreachableServers.push(
              `${server.serverName} (${network.ip})`
            );
            issues.errorDetails[`${server.serverName}-${network.ip}`] =
              error.message;

            logger.error(
              `Error in HTTP health check: ${server.serverName} (${network.ip})`,
              {
                operation: "health_check",
                serverName: server.serverName,
                endpoint: network.ip,
                error: error.message,
              }
            );
          }
        }

        // Add result to upstreams
        upstreams.push(result);
      }
    }
  );

  // Wait for all checks to complete
  await Promise.all(checkPromises);

  // Calculate summary
  const total = upstreams.length;
  const healthy = upstreams.filter((u) => u.healthy).length;
  const unhealthy = total - healthy;
  const healthyPercentage = total > 0 ? Math.round((healthy / total) * 100) : 0;

  // Determine overall status
  let overallStatus: "healthy" | "degraded" | "critical" = "healthy";

  if (!requiredServersCheck.healthy || !nginxConfigCheck.valid) {
    overallStatus = "critical";
  } else if (unhealthy > 0) {
    // If more than 25% of servers are unhealthy, consider it critical
    if (healthyPercentage < 75) {
      overallStatus = "critical";
    } else {
      overallStatus = "degraded";
    }
  }

  // Return comprehensive results
  return {
    upstreams,
    summary: {
      total,
      healthy,
      unhealthy,
      healthyPercentage,
      overallStatus,
    },
    requiredServersStatus: requiredServersCheck,
    containerHealthStatus: containerHealth,
    nginxStatus: {
      configValid: nginxConfigCheck.valid,
      errorMessage: nginxConfigCheck.error,
    },
    issues,
  };
};
