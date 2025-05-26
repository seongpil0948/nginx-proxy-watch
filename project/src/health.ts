// project/src/health.ts

import {
  collectContainerStats,
  calculateCpuUsage,
  calculateMemoryUsage,
  logger,
} from "./util";
import { serverListState } from "./state";
import { processContainerConfig } from "./util/container-config";
import { makeFiles } from "./util/make";
import { runningTargetContainers } from "./util/container-management";
import { checkRequiredServers, getRequiredServers } from "./health-checker";
import { docker } from "./config";

/**
 * Check if container exists and is accessible
 * @param containerId - Container ID to check
 * @returns Promise<boolean> - True if container exists and is accessible
 */
const containerExists = async (containerId: string): Promise<boolean> => {
  try {
    const container = docker.getContainer(containerId);
    await container.inspect();
    return true;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.debug(`Container not found: ${containerId}`, {
        operation: "containerExists",
        containerId,
      });
      return false;
    }
    logger.warn(`Error checking container existence: ${containerId}`, {
      operation: "containerExists",
      containerId,
      error: error.message,
    });
    return false;
  }
};

/**
 * Clean up non-existent containers from server state
 */
const cleanupNonExistentContainers = async (): Promise<void> => {
  const serverList = serverListState.get();
  const containerIdsToCheck = new Set<string>();

  // Collect all container IDs from server state
  Object.values(serverList).forEach((server) => {
    server.network.forEach((network) => {
      if (network.dockerId) {
        containerIdsToCheck.add(network.dockerId);
      }
    });
  });

  if (containerIdsToCheck.size === 0) {
    return;
  }

  logger.debug(
    `Checking existence of ${containerIdsToCheck.size} containers in state`,
    {
      operation: "cleanupNonExistentContainers",
      containerCount: containerIdsToCheck.size,
    }
  );

  // Check each container and remove non-existent ones
  const nonExistentContainers: string[] = [];
  const existenceChecks = Array.from(containerIdsToCheck).map(
    async (containerId) => {
      const exists = await containerExists(containerId);
      if (!exists) {
        nonExistentContainers.push(containerId);
      }
      return { containerId, exists };
    }
  );

  try {
    await Promise.all(existenceChecks);

    // Remove non-existent containers from state
    if (nonExistentContainers.length > 0) {
      logger.info(
        `Removing ${nonExistentContainers.length} non-existent containers from state`,
        {
          operation: "cleanupNonExistentContainers",
          removedContainers: nonExistentContainers,
        }
      );

      nonExistentContainers.forEach((containerId) => {
        serverListState.del(containerId);
      });

      // Clean up empty servers
      serverListState.cleanup();
    }
  } catch (error: any) {
    logger.error(`Error during container cleanup`, {
      operation: "cleanupNonExistentContainers",
      error: error.message,
    });
  }
};

const containerHealthCheck = async (): Promise<void> => {
  try {
    // First, clean up non-existent containers from state
    await cleanupNonExistentContainers();

    // Get target containers (VIRTUAL_HOST configured containers)
    const targetContainers = await runningTargetContainers();

    logger.info(
      `Health check: Found ${targetContainers.length} target containers`,
      {
        operation: "containerHealthCheck",
        targetContainerCount: targetContainers.length,
      }
    );

    // Get current server list managed by the state
    const currentServerList = serverListState.get();
    const managedContainerIds = new Set<string>();

    // Collect currently managed container IDs
    Object.values(currentServerList).forEach((server) => {
      server.network.forEach((network) => {
        if (network.dockerId) {
          managedContainerIds.add(network.dockerId);
        }
      });
    });

    // Identify missing containers and process them
    const missingContainers = [];
    let configUpdateNeeded = false;

    for (const { container, info, env } of targetContainers) {
      // Skip containers already managed
      if (managedContainerIds.has(container.Id)) {
        continue;
      }

      // Process container configuration and add it
      const containerConfig = processContainerConfig(container.Id, info, env);
      if (containerConfig) {
        missingContainers.push({
          id: container.Id,
          name: info.Name,
          config: containerConfig,
        });

        // Add to server state
        serverListState.set(containerConfig);
        configUpdateNeeded = true;

        logger.warn(
          `Detected and recovered missing container: ${container.Id}`,
          {
            operation: "containerHealthCheck",
            containerId: container.Id,
            containerName: info.Name,
            virtualHost: env.host,
          }
        );
      }
    }

    // Update nginx configuration if missing containers were found
    if (configUpdateNeeded) {
      logger.info(
        `Found ${missingContainers.length} missing containers, updating nginx configuration`,
        {
          operation: "containerHealthCheck_update",
          missingContainers: missingContainers.map((c) => ({
            id: c.id,
            name: c.name,
          })),
        }
      );

      try {
        await makeFiles();
        logger.info("Nginx configuration updated for missing containers");
      } catch (error: any) {
        logger.error(`Failed to update nginx configuration: ${error.message}`, {
          operation: "containerHealthCheck_makeFiles",
          error: error.message,
        });
      }
    }

    // Check required server health status
    const requiredServers = getRequiredServers();
    if (requiredServers.length > 0) {
      const healthStatus = await checkRequiredServers(
        requiredServers,
        currentServerList
      );

      if (!healthStatus.healthy) {
        logger.warn(`Required server health check failed`, {
          operation: "requiredServerHealthCheck",
          missing: healthStatus.missing,
          available: healthStatus.available,
          total: healthStatus.total,
        });
      }
    }

    // Collect container statistics for existing containers only
    const stats = serverListState.getStats();
    logger.debug(`Server state statistics`, {
      operation: "containerHealthCheck_stats",
      ...stats,
    });

    // Only collect stats for containers that actually exist
    for (const { container } of targetContainers) {
      try {
        const exists = await containerExists(container.Id);
        if (exists) {
          const stats = await collectContainerStats(container.Id);
          const cpuUsage = calculateCpuUsage(stats);
          const memoryUsage = calculateMemoryUsage(stats);

          logger.debug(`Container ${container.Id} stats:`, {
            operation: "containerHealthCheck_stats",
            name: container.Names[0],
            image: container.Image,
            cpuPercent: cpuUsage.toFixed(2) + "%",
            memoryPercent: memoryUsage.toFixed(2) + "%",
          });
        }
      } catch (error: any) {
        // Only log as warning since container might have been removed during check
        logger.warn(
          `Failed to collect stats for container ${container.Id}: ${error.message}`,
          {
            operation: "containerHealthCheck_stats",
            containerId: container.Id,
          }
        );
      }
    }
  } catch (error: any) {
    logger.error(`Health check failed: ${error.message}`, {
      operation: "containerHealthCheck",
      error: error.message,
    });
  }
};

// Schedule periodic container health check and configuration verification
export const scheduleHealthCheck = (
  intervalSeconds: number = 5 // Default to 5 seconds interval
): NodeJS.Timeout => {
  logger.info(
    `Scheduling container health check and configuration verification every ${intervalSeconds} seconds`
  );
  return setInterval(containerHealthCheck, intervalSeconds * 1000);
};
