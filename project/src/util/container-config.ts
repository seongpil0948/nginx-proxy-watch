// project/src/util/container-config.ts
import { existsSync } from "fs";
import { ContainerInspectInfo } from "dockerode";
import { IContainerStatusItem } from "@interfaces/watcher";
import { LOCATION_POSTFIX } from "../config";
import { logger } from "./logging";
import { extractContainerIP } from "./container";

/**
 * Validate IP:PORT format
 * @param ipPort - IP:PORT string to validate
 * @returns True if valid format
 */
function validateIpPort(ipPort: string): boolean {
  if (!ipPort || typeof ipPort !== "string") return false;

  const parts = ipPort.split(":");
  if (parts.length !== 2) return false;

  const [ip, port] = parts;
  if (!ip || ip.trim() === "" || !port || port.trim() === "") return false;

  // Basic IPv4 validation
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(ip.trim())) return false;

  // Port validation
  const portNum = parseInt(port.trim(), 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

  return true;
}

/**
 * Process container information to create server configuration
 * @param containerId - Container ID
 * @param containerInfo - Container inspection information
 * @param env - Parsed environment variables
 * @returns Processed container config item or null if invalid
 */
export function processContainerConfig(
  containerId: string,
  containerInfo: ContainerInspectInfo,
  env: any
): IContainerStatusItem | null {
  // Check if this container should be processed
  if (!env.host) {
    logger.debug(
      `Container ${containerId} does not have host environment variable. Ignoring.`,
      {
        operation: "processContainerConfig",
        containerId,
      }
    );
    return null;
  }

  // Extract IP using the improved function
  const ip = extractContainerIP(containerInfo.NetworkSettings);
  const port = env.port || 80;

  // Validate extracted IP and port combination
  const ipPortString = ip ? `${ip}:${port}` : undefined;

  if (!ipPortString || !validateIpPort(ipPortString)) {
    logger.warn(`Container ${containerId} has invalid network configuration`, {
      operation: "processContainerConfig",
      containerId,
      extractedIp: ip,
      port,
      ipPortString,
      containerName: containerInfo.Name,
      virtualHost: env.host,
    });

    // Still create the configuration but with empty network
    // This allows the container to be tracked but prevents invalid upstream generation
  }

  // Parse location information
  const locationList = parseLocationList(env.location);

  // Generate server name
  const serverName = generateServerName(env);

  // Get SSL certificate details
  const { certPath, keyPath } = getSslPaths(env);
  const sslEnabled = checkSslCertificatesExist(
    env.cert as "pem" | "crt" | undefined,
    env.ssl || env.group_host || env.host || ""
  );

  // Create network entry only if IP:PORT is valid
  const networkEntries = [];
  if (ipPortString && validateIpPort(ipPortString)) {
    networkEntries.push({
      dockerId: containerId,
      ip: ipPortString,
    });
  } else {
    logger.warn(
      `Container ${containerId} network entry skipped due to invalid IP:PORT`,
      {
        operation: "processContainerConfig",
        containerId,
        containerName: containerInfo.Name,
        virtualHost: env.host,
        extractedIp: ip,
        port,
      }
    );
  }

  // Create and return container status item
  const containerConfig: IContainerStatusItem = {
    serverName,
    host: env.group_host || env.host || "",
    port: port,
    network: networkEntries,
    isLocation: env.is_location?.toUpperCase(),
    location: locationList,
    sslCert: certPath,
    sslKey: keyPath,
    https: sslEnabled,
    groupYn: env.group_host ? "Y" : "N",
    locationPath: env.location_path,
    routingCookieName: env.cookie_name,
    routingMap: env.routing_map,
    defaultUpstream: env.default_upstream,
  };

  logger.debug(`Container configuration processed`, {
    operation: "processContainerConfig",
    containerId,
    serverName,
    networkEntries: networkEntries.length,
    hasValidNetwork: networkEntries.length > 0,
  });

  return containerConfig;
}

/**
 * Parse location string from environment variable
 * @param locationStr - Location string (format: "host:path,host:path")
 * @returns Array of location objects or undefined
 */
export function parseLocationList(
  locationStr?: string
): { host: string; path: string }[] | undefined {
  if (!locationStr) return undefined;

  return locationStr
    .split(",")
    .map((locInfo) => {
      const locData = locInfo.split(":");
      if (locData.length === 2) {
        return {
          host: `${locData[0]}${LOCATION_POSTFIX}`,
          path: locData[1],
        };
      }
      return undefined;
    })
    .filter((item): item is { host: string; path: string } => !!item);
}

/**
 * Generate server name based on container environment
 * @param env - Container environment variables
 * @returns Generated server name
 */
export function generateServerName(env: {
  host?: string;
  is_location?: string;
  group_host?: string;
  location_path?: string;
}): string {
  if (!env.host) {
    throw new Error("Host environment variable is required");
  }

  return `${env.host}${
    env.is_location?.toUpperCase() === "Y" ? LOCATION_POSTFIX : ""
  }${env.group_host ? "_" + env.location_path : ""}`;
}

/**
 * Get SSL certificate paths
 * @param env - Container environment with SSL settings
 * @returns Object with paths to certificate and key files
 */
export function getSslPaths(env: {
  cert?: "pem" | "crt";
  ssl?: string;
  group_host?: string;
  host?: string;
}): { certPath: string; keyPath: string } {
  const host = env.ssl || env.group_host || env.host || "";

  return env.cert === "pem"
    ? {
        certPath: `/etc/nginx/certs/${host}_crt.pem`,
        keyPath: `/etc/nginx/certs/${host}_key.pem`,
      }
    : {
        certPath: `/etc/nginx/certs/${host}.crt`,
        keyPath: `/etc/nginx/certs/${host}.key`,
      };
}

/**
 * Check if SSL certificates exist
 * @param certType - Certificate type (pem or crt)
 * @param host - Host name for certificate
 * @returns True if certificates exist
 */
export function checkSslCertificatesExist(
  certType: "pem" | "crt" | undefined,
  host: string
): boolean {
  if (!host) return false;

  return certType === "pem"
    ? existsSync(`/etc/nginx/certs/${host}_crt.pem`) &&
        existsSync(`/etc/nginx/certs/${host}_key.pem`)
    : existsSync(`/etc/nginx/certs/${host}.crt`) &&
        existsSync(`/etc/nginx/certs/${host}.key`);
}
