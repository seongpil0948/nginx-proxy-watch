// project/src/util/logging.ts
import * as winston from "winston";
import { TransformableInfo } from "logform";
import * as fs from "fs";
// Import the daily rotate file transport
import DailyRotateFile from "winston-daily-rotate-file";

// Winston's TransformableInfo extension interface
interface ExtendedTransformableInfo extends TransformableInfo {
  [key: string]: any;
}

// Extended logger interface definition
interface ExtendedLogger extends winston.Logger {
  dockerEvent: (
    eventType: string,
    containerId: string,
    details?: Record<string, any>
  ) => void;
  containerState: (
    containerId: string,
    state: string,
    details?: Record<string, any>
  ) => void;
  nginxConfig: (
    action: string,
    configPath: string,
    details?: Record<string, any>
  ) => void;
}

const plainTextFormat = winston.format.printf(
  (info: ExtendedTransformableInfo) => {
    const { level, message, timestamp, ...metadata } = info;
    let metaStr = "";

    if (
      Object.keys(metadata).length > 0 &&
      metadata.message === undefined &&
      metadata.service !== undefined
    ) {
      metaStr = ` | ${JSON.stringify(metadata)}`;
    }

    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }
);

// Unified plain text format
const cleanFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSSZ",
  }),
  plainTextFormat
);

const LOG_DIR = "/var/log/docker-event-watcher";

// Create log directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configure the daily rotate file transport options
const dailyRotateOptions = {
  dirname: LOG_DIR,
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "10m", // Rotate when file reaches 20MB
  maxFiles: "14d", // Keep logs for 14 days
  format: cleanFormat,
  auditFile: `${LOG_DIR}/audit.json`, // Tracks rotated files
};

// Base logger creation with rotating file transports
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "docker-event-watcher" },
  exitOnError: false,
  format: cleanFormat,
  transports: [
    // Console output - plain text
    new winston.transports.Console(),

    // All logs to a combined rotating file (for OpenTelemetry collector)
    new DailyRotateFile({
      ...dailyRotateOptions,
      filename: "watcher-%DATE%.log",
    }),

    // Error level logs to separate rotating file
    new DailyRotateFile({
      ...dailyRotateOptions,
      filename: "error-%DATE%.log",
      level: "error",
    }),

    // Debug level logs to separate rotating file
    new DailyRotateFile({
      ...dailyRotateOptions,
      filename: "debug-%DATE%.log",
      level: "debug",
    }),
  ],
});

// Logger extension - add utility functions
const logger = baseLogger as ExtendedLogger;

// Docker event logging function
logger.dockerEvent = (
  eventType: string,
  containerId: string,
  details: Record<string, any> = {}
) => {
  logger.info(`Docker event detected: ${eventType}`, {
    operation: "docker_event",
    eventType,
    containerId,
    ...details,
  });
};

// Container state change logging function
logger.containerState = (
  containerId: string,
  state: string,
  details: Record<string, any> = {}
) => {
  logger.info(`Container state change: ${state}`, {
    operation: "container_state_change",
    containerId,
    state,
    ...details,
  });
};

// Nginx config change logging function
logger.nginxConfig = (
  action: string,
  configPath: string,
  details: Record<string, any> = {}
) => {
  logger.info(`Nginx config ${action}`, {
    operation: "nginx_config",
    action,
    configPath,
    ...details,
  });
};

// Process event handlers
process.on("exit", () => {
  logger.info("Docker monitoring service shutting down");
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught exception occurred", {
    error: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled Promise rejection", { reason });
});

logger.info("Logging system initialized with rotation enabled");

export { logger };
