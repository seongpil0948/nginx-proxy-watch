// project/src/api-server.ts
import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { AddressInfo } from "net";
import { docker } from "./config";
import { serverListState } from "./state";
import { logger } from "./util";
import {
  checkContainerHealth,
  checkNginxConfig,
  checkRequiredServers,
  checkServiceHealth,
  getRequiredServers,
} from "./health-checker";

/**
 * API server for monitoring and health checks
 * Supports both HTTP and HTTPS protocols
 */
export const startApiServer = async (
  port: number = 8080
): Promise<http.Server | https.Server> => {
  const app = express();

  // JSON middleware
  app.use(express.json());

  // Middleware for logging requests
  app.use((req, res, next) => {
    logger.info(`API Request: ${req.method} ${req.path}`, {
      operation: "api_request",
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  // Basic info endpoint
  app.get("/", (req, res) => {
    res.json({
      service: "nginx-proxy-watch",
      description: "Docker container monitoring for nginx reverse proxy",
      endpoints: [
        "/health",
        "/status",
        "/upstreams",
        "/containers",
        "/containers/:id/health",
        "/required-servers",
        "/required-servers/verify",
        "/nginx-config",
      ],
    });
  });

  app.get("/health", async (req, res) => {
    try {
      // Get server list
      const serverList = serverListState.get();
      const serverCount = Object.keys(serverList).length;

      // Get required servers list
      const requiredServers = getRequiredServers();

      // Check required servers with enhanced check
      const requiredCheck = await checkRequiredServers(
        requiredServers,
        serverList
      );

      // Detailed health status determination
      let status = "healthy";
      if (!requiredCheck.healthy) {
        // If any required service is unhealthy, set status to critical
        status = "critical";
      } else if (requiredCheck.services.some((s) => !s.healthy)) {
        // If non-required services have issues, set to degraded
        status = "degraded";
      }

      // Set appropriate HTTP status code
      const httpStatus =
        status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

      // Return detailed health report
      res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        servers: {
          total: serverCount,
          required: requiredCheck.total,
          requiredAvailable: requiredCheck.available,
        },
        requiredServersHealthy: requiredCheck.healthy,
        unhealthyServices: requiredCheck.missing,
        details: requiredCheck.services
          .filter((s) => !s.healthy)
          .map((s) => ({
            name: s.serviceName,
            containers: s.containers.length,
            unhealthyCount: s.containers.filter((c) => !c.healthy).length,
          })),
      });
    } catch (error: any) {
      logger.error(`Health check failed`, {
        operation: "health_check",
        error: error.message,
      });

      res.status(500).json({
        status: "error",
        message: "Health check failed",
        error: error.message,
      });
    }
  });

  // Add new endpoint for service-level health checks
  app.get("/services/health", async (req, res) => {
    try {
      const serverList = serverListState.get();
      const serverNames = Object.keys(serverList);

      // Process all services in parallel for efficiency
      const serviceChecks = await Promise.all(
        serverNames.map((name) => checkServiceHealth(name, serverList))
      );

      // Calculate summary stats
      const healthy = serviceChecks.filter((s) => s.healthy).length;
      const unhealthy = serviceChecks.length - healthy;

      res.json({
        timestamp: new Date().toISOString(),
        summary: {
          total: serviceChecks.length,
          healthy,
          unhealthy,
          healthyPercentage:
            serviceChecks.length > 0
              ? Math.round((healthy / serviceChecks.length) * 100)
              : 100,
        },
        services: serviceChecks,
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: "Service health check failed",
        error: error.message,
      });
    }
  });

  // Add detailed status page endpoint
  app.get("/status", async (req, res) => {
    try {
      const serverList = serverListState.get();
      const requiredServers = getRequiredServers();

      // Use enhanced check for required servers
      const requiredCheck = await checkRequiredServers(
        requiredServers,
        serverList
      );

      // Check nginx configuration
      const nginxConfig = await checkNginxConfig();

      // Overall status determination
      let overallStatus = "healthy";

      if (!requiredCheck.healthy || !nginxConfig.valid) {
        overallStatus = "critical";
      } else if (requiredCheck.services.some((s) => !s.healthy)) {
        overallStatus = "degraded";
      }

      res.json({
        timestamp: new Date().toISOString(),
        status: overallStatus,
        components: {
          requiredServers: {
            status: requiredCheck.healthy ? "healthy" : "critical",
            available: requiredCheck.available,
            total: requiredCheck.total,
            missing: requiredCheck.missing,
          },
          nginx: {
            status: nginxConfig.valid ? "healthy" : "critical",
            error: nginxConfig.error,
          },
        },
        services: requiredCheck.services.map((s) => ({
          name: s.serviceName,
          status: s.healthy ? "healthy" : "unhealthy",
          containers: {
            total: s.containers.length,
            healthy: s.containers.filter((c) => c.healthy).length,
            unhealthy: s.containers.filter((c) => !c.healthy).length,
          },
        })),
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: "Status check failed",
        error: error.message,
      });
    }
  });

  // List all managed containers
  app.get("/containers", async (req, res) => {
    try {
      const serverList = serverListState.get();
      const containerMap = new Map();

      // Extract container IDs from server list
      Object.values(serverList).forEach((server) => {
        server.network.forEach((network) => {
          if (network.dockerId && !containerMap.has(network.dockerId)) {
            containerMap.set(network.dockerId, {
              id: network.dockerId,
              serverName: server.serverName,
              endpoint: network.ip,
              location: server.locationPath,
              isHttps: server.https,
            });
          }
        });
      });

      const containerList = Array.from(containerMap.values());

      res.json({
        count: containerList.length,
        containers: containerList,
      });
    } catch (error: any) {
      logger.error(`Containers check failed`, {
        operation: "containers_check",
        error: error.message,
      });

      res.status(500).json({
        status: "error",
        message: "Containers check failed",
        error: error.message,
      });
    }
  });

  // Check specific container health
  app.get("/containers/:id/health", async (req, res) => {
    try {
      const containerId = req.params.id;

      // Check container health
      const health = await checkContainerHealth(containerId);

      res.json({
        id: containerId,
        healthy: health.healthy,
        status: health.status,
        exitCode: health.exitCode,
        error: health.error,
        name: health.name,
        restarts: health.restarts,
        startedAt: health.startedAt,
        health: health.health,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`Container health check failed`, {
        operation: "container_health_check",
        containerId: req.params.id,
        error: error.message,
      });

      res.status(500).json({
        status: "error",
        message: "Container health check failed",
        error: error.message,
      });
    }
  });

  // Check required servers status
  app.get("/required-servers", async (req, res) => {
    try {
      const requiredServers = getRequiredServers();
      const serverList = serverListState.get();
      const check = await checkRequiredServers(requiredServers, serverList);

      res.json({
        requiredServers,
        check,
        availableServers: Object.keys(serverList),
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: "Required servers check failed",
        error: error.message,
      });
    }
  });

  // Verify required servers with detailed container checks
  app.get("/required-servers/verify", async (req, res) => {
    try {
      const requiredServers = getRequiredServers();
      const serverList = serverListState.get();

      // Get detailed verification results
      const check = await checkRequiredServers(requiredServers, serverList);

      // Get additional container details for debugging
      const containerDetails = [];

      for (const server of requiredServers) {
        if (serverList[server]) {
          const serverConfig = serverList[server];

          for (const network of serverConfig.network) {
            if (network.dockerId) {
              try {
                const containerHealth = await checkContainerHealth(
                  network.dockerId
                );
                containerDetails.push({
                  serverName: server,
                  containerId: network.dockerId,
                  endpoint: network.ip,
                  healthy: containerHealth.healthy,
                  status: containerHealth.status,
                  error: containerHealth.error,
                  healthCheckStatus: containerHealth.health?.status || "none",
                });
              } catch (error: any) {
                containerDetails.push({
                  serverName: server,
                  containerId: network.dockerId,
                  endpoint: network.ip,
                  error: error.message,
                });
              }
            }
          }
        }
      }

      res.json({
        requiredServers,
        check,
        containerDetails,
        availableServers: Object.keys(serverList),
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: "Required servers verification failed",
        error: error.message,
      });
    }
  });

  // Check Nginx configuration
  app.get("/nginx-config", async (req, res) => {
    try {
      const { exec } = require("child_process");

      exec("nginx -t", (error: any, stdout: string, stderr: string) => {
        if (error) {
          res.status(500).json({
            valid: false,
            error: stderr || error.message,
            command: "nginx -t",
            exitCode: error.code,
          });
        } else {
          res.json({
            valid: true,
            output: stderr, // nginx -t outputs to stderr even when successful
            command: "nginx -t",
          });
        }
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: "Nginx configuration check failed",
        error: error.message,
      });
    }
  });

  // Check if HTTPS is enabled via environment variables (default: true)
  const httpsEnabled = process.env.API_HTTPS_ENABLED !== "false";
  const httpsPort = parseInt(process.env.API_HTTPS_PORT || "8443");

  // Create HTTP server
  const httpServer = http.createServer(app);

  // Start HTTP server
  httpServer.listen(port, () => {
    const address = httpServer.address() as AddressInfo;
    logger.info(`API HTTP server listening on port ${address.port}`, {
      operation: "api_http_server_start",
      port: address.port,
    });
  });

  // Create and start HTTPS server if enabled
  if (httpsEnabled) {
    try {
      // Certificate paths
      const certPath =
        process.env.API_HTTPS_CERT_PATH ||
        "/app/project/src/certs/shop.co.kr_crt.pem";
      const keyPath =
        process.env.API_HTTPS_KEY_PATH ||
        "/app/project/src/certs/shop.co.kr_key.pem";

      // Check if certificate files exist
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        logger.error("HTTPS certificate files not found", {
          operation: "api_https_server_start",
          certPath,
          keyPath,
        });
      } else {
        // HTTPS options
        const httpsOptions = {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        };

        // Create HTTPS server
        const httpsServer = https.createServer(httpsOptions, app);

        // Start HTTPS server
        httpsServer.listen(httpsPort, () => {
          const address = httpsServer.address() as AddressInfo;
          logger.info(`API HTTPS server listening on port ${address.port}`, {
            operation: "api_https_server_start",
            port: address.port,
          });
        });
      }
    } catch (error: any) {
      logger.error("Failed to start HTTPS server", {
        operation: "api_https_server_start",
        error: error.message,
      });
    }
  }

  return httpServer;
};
