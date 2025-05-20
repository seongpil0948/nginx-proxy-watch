// project/src/api-server.ts
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { docker } from "./config";
import { serverListState } from "./state";
import { logger } from "./util";
import {
  checkUpstreamHealth,
  checkContainerHealth,
  checkRequiredServers,
  getRequiredServers,
  CheckType,
} from "./health-checker";

/**
 * API server for monitoring and health checks
 */
export const startApiServer = async (
  port: number = 8080
): Promise<http.Server> => {
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

  // Simple health endpoint
  app.get("/health", async (req, res) => {
    try {
      // Quick health check - avoid full scanning for performance
      const serverList = serverListState.get();
      const serverCount = Object.keys(serverList).length;

      // Check required servers only
      const requiredServers = getRequiredServers();
      const requiredCheck = await checkRequiredServers(
        requiredServers,
        serverList
      );

      // Health status determination
      let status = "healthy";
      if (!requiredCheck.healthy) {
        status = "critical";
      }

      // HTTP status code based on health
      const httpStatus =
        status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

      res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        servers: {
          total: serverCount,
          required: requiredCheck.total,
          requiredAvailable: requiredCheck.available,
        },
        requiredServersHealthy: requiredCheck.healthy,
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

  // Detailed status endpoint with expanded health check information
  app.get("/status", async (req, res) => {
    try {
      // Parse query parameters
      const checkTypes: CheckType[] = req.query.checks
        ? ((req.query.checks as string).split(",") as CheckType[])
        : ["http", "containerStatus", "requiredServer", "nginxConfig"];

      const httpCheckPath = (req.query.path as string) || "/status";
      const httpTimeout = req.query.timeout
        ? parseInt(req.query.timeout as string, 10)
        : 5000;

      // Get current state
      const serverList = serverListState.get();

      // Get comprehensive health status
      const upstreamsHealth = await checkUpstreamHealth({
        httpCheckPath,
        httpTimeout,
        checkTypes,
      });

      // Build detailed response
      const response = {
        timestamp: new Date().toISOString(),
        overallStatus: upstreamsHealth.summary.overallStatus,
        serverCount: Object.keys(serverList).length,
        upstreamsCount: upstreamsHealth.summary.total,
        upstreamsHealthy: upstreamsHealth.summary.healthy,
        upstreamsHealthyPercentage: upstreamsHealth.summary.healthyPercentage,
        containerStatus: upstreamsHealth.containerHealthStatus,
        requiredServers: upstreamsHealth.requiredServersStatus,
        nginxConfig: upstreamsHealth.nginxStatus,
        issues: upstreamsHealth.issues,
      };

      // Set HTTP status code based on health status
      const statusCode =
        upstreamsHealth.summary.overallStatus === "healthy"
          ? 200
          : upstreamsHealth.summary.overallStatus === "degraded"
          ? 200
          : 503;

      res.status(statusCode).json(response);
    } catch (error: any) {
      logger.error(`Status check failed`, {
        operation: "status_check",
        error: error.message,
      });

      res.status(500).json({
        status: "error",
        message: "Status check failed",
        error: error.message,
      });
    }
  });

  // List all upstream servers with health status
  app.get("/upstreams", async (req, res) => {
    try {
      const options = {
        httpCheckPath: (req.query.path as string) || "/status",
        httpTimeout: req.query.timeout
          ? parseInt(req.query.timeout as string, 10)
          : 5000,
        checkTypes: ["http"] as CheckType[],
      };

      const upstreamsHealth = await checkUpstreamHealth(options);

      res.json({
        upstreams: upstreamsHealth.upstreams,
        summary: upstreamsHealth.summary,
      });
    } catch (error: any) {
      logger.error(`Upstreams check failed`, {
        operation: "upstreams_check",
        error: error.message,
      });

      res.status(500).json({
        status: "error",
        message: "Upstreams check failed",
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

  // Create HTTP server
  const server = http.createServer(app);

  // Start the server
  server.listen(port, () => {
    const address = server.address() as AddressInfo;
    logger.info(`API server listening on port ${address.port}`, {
      operation: "api_server_start",
      port: address.port,
    });
  });

  return server;
};
