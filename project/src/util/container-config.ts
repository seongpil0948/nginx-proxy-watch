// project/src/util/container-config.ts
import { existsSync } from "fs";
import { ContainerInspectInfo } from "dockerode";
import { IContainerStatusItem } from "@interfaces/watcher";
import { LOCATION_POSTFIX } from "../config";
import { logger } from "./logging";
import { extractContainerIP } from "./container";

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
      `컨테이너 ${containerId}에 host 환경변수가 없습니다. 무시합니다.`
    );
    return null;
  }

  // Extract IP using the improved function
  const ip = extractContainerIP(containerInfo.NetworkSettings);
  const port = env.port || 80;

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

  // Create and return container status item
  return {
    serverName,
    host: env.group_host || env.host || "",
    port: port,
    network: [
      {
        dockerId: containerId,
        ip: ip ? `${ip}:${port}` : undefined,
      },
    ],
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
