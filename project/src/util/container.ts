// project/src/util/container.ts
import { ContainerInspectInfo } from "dockerode";
import { logger } from "./logging";

/**
 * Get valid IP address from NetworkSettings with robust network traversal
 * @param networkSettings - Container's network settings from dockerode
 * @returns Container IP address or null if not found
 */
export function extractContainerIP(
  networkSettings: ContainerInspectInfo["NetworkSettings"]
): string | null {
  // First check direct IPAddress (for backward compatibility)
  if (networkSettings?.IPAddress && isValidIPv4(networkSettings.IPAddress)) {
    logger.debug("Found IP in root IPAddress field", {
      ip: networkSettings.IPAddress,
    });
    return networkSettings.IPAddress;
  }

  // If no valid direct IP, check Networks object
  if (networkSettings?.Networks) {
    // First try 'bridge' network if exists (common default)
    if (
      networkSettings.Networks.bridge &&
      isValidIPv4(networkSettings.Networks.bridge.IPAddress)
    ) {
      logger.debug("Found IP in bridge network", {
        ip: networkSettings.Networks.bridge.IPAddress,
      });
      return networkSettings.Networks.bridge.IPAddress;
    }

    // Otherwise try any network with valid IP
    for (const networkName in networkSettings.Networks) {
      const networkInfo = networkSettings.Networks[networkName];
      if (networkInfo && isValidIPv4(networkInfo.IPAddress)) {
        logger.debug(`Found IP in ${networkName} network`, {
          ip: networkInfo.IPAddress,
          network: networkName,
        });
        return networkInfo.IPAddress;
      }
    }
  }

  // Log the complete network settings for debugging
  logger.warn("Could not find valid container IP address", {
    networkSettings: JSON.stringify(networkSettings, null, 2),
  });
  return null;
}

/**
 * Validate IPv4 address format
 * @param ip - IP address to validate
 * @returns True if valid IPv4 address
 */
function isValidIPv4(ip: string | undefined): boolean {
  if (!ip) return false;

  const ipRegex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip);
}

/**
 * Extract port info from container network settings
 * @param networkSettings - Container's network settings
 * @param defaultPort - Default port to use if none found
 * @returns Port number or default port
 */
export function extractContainerPort(
  networkSettings: ContainerInspectInfo["NetworkSettings"],
  defaultPort: number = 80
): number {
  if (!networkSettings?.Ports) {
    return defaultPort;
  }

  // Try to find exposed port from ports mapping
  for (const portMapping in networkSettings.Ports) {
    const mappings = networkSettings.Ports[portMapping];
    if (Array.isArray(mappings) && mappings.length > 0) {
      const hostPort = mappings[0]?.HostPort;
      if (hostPort && /^\d+$/.test(hostPort)) {
        return parseInt(hostPort, 10);
      }
    }
  }

  // If no port found in mappings, extract from the port format (e.g. "8080/tcp")
  for (const portStr in networkSettings.Ports) {
    const match = portStr.match(/^(\d+)\//);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }

  return defaultPort;
}

/**
 * Get formatted IP:Port string for container
 * @param networkSettings - Container network settings
 * @param envPort - Port from environment variables
 * @returns Formatted "IP:Port" string or undefined if IP not found
 */
export function getContainerIPPort(
  networkSettings: ContainerInspectInfo["NetworkSettings"],
  envPort?: number
): string | undefined {
  const ip = extractContainerIP(networkSettings);
  if (!ip) return undefined;

  const port = envPort || extractContainerPort(networkSettings);
  return `${ip}:${port}`;
}

/**
 * Get complete container network information for monitoring
 * @param networkSettings - Container network settings
 * @returns Network information object with all discovered details
 */
export function getContainerNetworkInfo(
  networkSettings: ContainerInspectInfo["NetworkSettings"]
): {
  ip: string | null;
  port: number | null;
  networks: Array<{
    name: string;
    ip: string;
    gateway: string;
    aliases: string[];
  }>;
} {
  const ip = extractContainerIP(networkSettings);
  const port = extractContainerPort(networkSettings);
  const networks = [];

  // Extract information about all networks
  if (networkSettings?.Networks) {
    for (const networkName in networkSettings.Networks) {
      const network = networkSettings.Networks[networkName];
      networks.push({
        name: networkName,
        ip: network.IPAddress,
        gateway: network.Gateway,
        aliases: network.Aliases || [],
      });
    }
  }

  return {
    ip,
    port,
    networks,
  };
}
