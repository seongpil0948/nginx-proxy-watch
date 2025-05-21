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
    logger.debug(`No required servers specified in environment variable`, {
      operation: "getRequiredServers",
    });
    return [];
  }
  logger.debug(`Parsing required servers from environment variable`, {
    operation: "getRequiredServers",
    requiredServersEnv,
  });
  return requiredServersEnv
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server.length > 0);
};

// project/src/health-checker.ts (일부 코드만 표시)

/**
 * Service health status with container details
 */
interface ServiceHealth {
  serviceName: string;
  healthy: boolean;
  containers: Array<{
    id: string;
    healthy: boolean;
    status: string;
    error?: string;
  }>;
  lastChecked: string;
}

/**
 * Enhanced container health check with deep inspection
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

      // Important: Also check for 'starting' state - not yet healthy
      if (healthStatus === "starting") {
        healthy = false;
        error = "Container health check in progress";
      } else if (!healthy && healthLog && healthLog.length > 0) {
        const latestLog = healthLog[healthLog.length - 1];
        error = latestLog.Output?.trim() || "Unhealthy container";
      }
    } else if (status !== "running") {
      // Container is not running and has no health check
      healthy = false;

      if (status === "exited") {
        error = `Container exited with code ${exitCode}`;
      } else if (status === "restarting") {
        error = "Container is restarting";
      } else {
        error = `Container status: ${status}`;
      }
    }

    // Enhanced logging for health status changes
    logger.debug(`Container ${containerId} health check result`, {
      operation: "checkContainerHealth",
      containerId,
      name,
      status,
      healthStatus,
      healthy,
      error,
    });

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
              output: Output?.trim() || "",
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
 * Check health of a service by examining all its containers
 * @param serverName - Name of the service to check
 * @param serverList - Current server configuration
 * @returns Service health status
 */
export const checkServiceHealth = async (
  serverName: string,
  serverList: Record<string, IContainerStatusItem>
): Promise<ServiceHealth> => {
  const server = serverList[serverName];

  if (!server) {
    return {
      serviceName: serverName,
      healthy: false,
      containers: [],
      lastChecked: new Date().toISOString(),
    };
  }

  const containerResults = [];
  let serviceHealthy = false;

  // Check each container for this service
  for (const network of server.network) {
    if (!network.dockerId) continue;

    try {
      const containerHealth = await checkContainerHealth(network.dockerId);
      containerResults.push({
        id: network.dockerId,
        healthy: containerHealth.healthy,
        status: containerHealth.status,
        error: containerHealth.error,
      });

      // If at least one container is healthy, service is considered healthy
      if (containerHealth.healthy) {
        serviceHealthy = true;
      }
    } catch (error: any) {
      containerResults.push({
        id: network.dockerId,
        healthy: false,
        status: "error",
        error: error.message,
      });
    }
  }

  // If no containers found or all unhealthy, service is unhealthy
  return {
    serviceName: serverName,
    // Service is healthy only if at least one container is healthy
    healthy: serviceHealthy && containerResults.length > 0,
    containers: containerResults,
    lastChecked: new Date().toISOString(),
  };
};

/**
 * Improved required servers check that verifies each service's health
 */
export const checkRequiredServers = async (
  requiredServers: string[],
  serverList: Record<string, IContainerStatusItem>
): Promise<{
  healthy: boolean;
  total: number;
  available: number;
  missing: string[];
  services: ServiceHealth[];
}> => {
  if (requiredServers.length === 0) {
    logger.debug(`No required servers to check`, {
      operation: "checkRequiredServers",
    });
    return {
      healthy: true,
      total: 0,
      available: 0,
      missing: [],
      services: [],
    };
  }

  const serviceResults = [];
  const missing = [];

  // Check each required service
  for (const serverName of requiredServers) {
    const serviceHealth = await checkServiceHealth(serverName, serverList);
    serviceResults.push(serviceHealth);

    // If service is not healthy, add to missing list
    if (!serviceHealth.healthy) {
      missing.push(serverName);
      logger.warn(`Required server unhealthy: ${serverName}`, {
        operation: "checkRequiredServers",
        serviceName: serverName,
        containers: serviceHealth.containers.length,
        details: serviceHealth.containers,
      });
    }
  }

  // Calculate summary
  const available = requiredServers.length - missing.length;
  const healthy = missing.length === 0;

  return {
    healthy,
    total: requiredServers.length,
    available,
    missing,
    services: serviceResults,
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
