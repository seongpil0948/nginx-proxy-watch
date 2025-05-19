// project/src/util/container-management.ts
import { ContainerInfo } from "dockerode";
import { docker } from "../config";
import { getContainerEnv, logger } from "./index";
import { ContainerEnv } from "@interfaces/watcher";
import { parseErrorMsg } from "./error";

/**
 * Container filtering options
 */
export interface ContainerFilterOptions {
  /** Include only running containers if true (default: true) */
  onlyRunning?: boolean;
  /** Additional Docker API filters */
  additionalFilters?: Record<string, string[]>;
  /** Process only containers with specific environment variable */
  requireEnvVar?: keyof ContainerEnv;
}

/**
 * Get all target containers that should be managed by nginx-proxy-watch
 * @param options - Container filtering options
 * @returns Promise with array of filtered containers with their config
 */
export const runningTargetContainers = async (
  options: ContainerFilterOptions = {}
): Promise<
  Array<{
    container: ContainerInfo;
    info: any;
    env: any;
  }>
> => {
  // Set default options
  const {
    onlyRunning = true,
    additionalFilters = {},
    requireEnvVar = "host", // Default to filter by 'host' (VIRTUAL_HOST) env var
  } = options;

  // Prepare Docker API filters
  const filters: Record<string, string[]> = {
    ...additionalFilters,
  };

  // Add running status filter if required
  if (onlyRunning) {
    filters.status = ["running"];
  }

  logger.debug(`Fetching containers with filters`, {
    operation: "runningTargetContainers",
    filters,
  });

  try {
    // Get containers from Docker API
    const containers = await new Promise<ContainerInfo[]>((resolve, reject) => {
      docker.listContainers(
        { all: !onlyRunning, filters },
        (err, containers) => {
          if (err) {
            reject(err);
          } else {
            resolve(containers || []);
          }
        }
      );
    });

    logger.debug(`Found ${containers.length} total containers`, {
      operation: "runningTargetContainers",
    });

    // Filter and process containers
    const targetContainers = [];

    for (const container of containers) {
      try {
        // Get container details
        const containerObj = docker.getContainer(container.Id);
        const info = await containerObj.inspect();
        const env = getContainerEnv(info?.Config.Env);
        if (requireEnvVar && !env[requireEnvVar]) {
          continue; // Skip containers without required env var
        }

        // Add to target containers
        targetContainers.push({
          container,
          info,
          env,
        });
      } catch (error: unknown) {
        logger.warn(`Error processing container ${container.Id}`, {
          operation: "runningTargetContainers",
          containerId: container.Id,
          error: parseErrorMsg(error),
        });
      }
    }

    logger.info(
      `Found ${targetContainers.length} target containers out of ${containers.length} total`,
      {
        operation: "runningTargetContainers",
      }
    );

    return targetContainers;
  } catch (error) {
    logger.error(`Failed to fetch target containers`, {
      operation: "runningTargetContainers",
      error: parseErrorMsg(error),
    });
    throw error;
  }
};
