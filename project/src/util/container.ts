import { ContainerInspectInfo } from "dockerode";
import { logger } from "./logging";

/**
 * Get valid IP address from NetworkSettings with regex validation
 */
export function getContainerIP(
  networkSettings: ContainerInspectInfo["NetworkSettings"]
): { ipAddress: string; port: number } | null {
  // Function to validate IP address
  const isValidIPv4 = (ip: string) => {
    const ip_regex =
      /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const isValid = ip && typeof ip === "string" && ip_regex.test(ip);
    if (!isValid) {
      logger.warn(`유효하지 않은 IP 주소 IP: ${ip}`);
    }
    return isValid;
  };

  let validIP: string | null = null;
  let port: number | null = null;

  // Check direct IPAddress first
  if (isValidIPv4(networkSettings?.IPAddress)) {
    logger.debug("Root Network IP 주소를 찾았습니다.");
    validIP = networkSettings.IPAddress;
  }

  // If no valid direct IP, check Networks
  if (!validIP && networkSettings?.Networks) {
    const networks = networkSettings.Networks;

    // Loop through all networks to find valid IP
    for (const networkName in networks) {
      const network = networks[networkName];
      if (isValidIPv4(network?.IPAddress)) {
        logger.debug(`네트워크 ${networkName}에서 IP 주소를 찾았습니다.`);
        validIP = network.IPAddress;
        break;
      }
    }
  }

  // Get port information if available
  if (networkSettings?.Ports) {
    const ports = networkSettings.Ports;

    // Find first valid port mapping
    for (const portMapping in ports) {
      const mappings = ports[portMapping];
      if (Array.isArray(mappings) && mappings.length > 0) {
        const hostPort = mappings[0]?.HostPort;
        if (hostPort && /^\d+$/.test(hostPort)) {
          port = parseInt(hostPort, 10);
          break;
        }
      }
    }
  }

  if (validIP && port) {
    return {
      ipAddress: validIP,
      port: port,
    };
  }
  logger.warn(
    `유효한 컨테이너 IP 주소를 찾을 수 없습니다 ${JSON.stringify(
      networkSettings,
      null,
      2
    )}.`
  );

  return null;
}
