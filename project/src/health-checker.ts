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
    console.log(`CNAME: ${name}  CID: ${info.Id} Status: ${status}`);
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
      continue; // Skip to next server since this one is missing
    }

    // Check containers for this server
    const serverConfig = serverList[server];

    // Check if server has any network entries
    if (!serverConfig.network || serverConfig.network.length === 0) {
      missing.push(server);
      logger.warn(`Required server has no network entries: ${server}`, {
        operation: "checkRequiredServers",
        server,
      });
      continue; // Skip to next server
    }

    // Check each container for this server
    let hasValidContainer = false;

    for (const network of serverConfig.network) {
      // Skip entries without container ID
      if (!network.dockerId) continue;

      try {
        // Check container exists and is healthy
        const containerHealth = await checkContainerHealth(network.dockerId);

        if (containerHealth.healthy) {
          hasValidContainer = true;
          // Found a healthy container, no need to check others
          break;
        } else {
          // Track unhealthy container
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
        logger.error(`Error checking container health: ${network.dockerId}`, {
          operation: "checkRequiredServers",
          server,
          containerId: network.dockerId,
          error: error.message,
        });

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
  }

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
