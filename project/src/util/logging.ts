import * as winston from "winston";
import { TransformableInfo } from "logform";
import * as fs from "fs";

// Winston의 TransformableInfo를 확장한 로그 인터페이스
interface ExtendedTransformableInfo extends TransformableInfo {
  [key: string]: any;
}

// 확장된 로거 인터페이스 정의
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

    // 메타데이터가 있고 message 속성이 없는 경우에만 JSON 추가
    if (
      Object.keys(metadata).length > 0 &&
      metadata.message === undefined &&
      metadata.service !== undefined
    ) {
      metaStr = ` | ${JSON.stringify(metadata)}`;
    }

    // 순수 텍스트 형식
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }
);

// 통합 순수 텍스트 포맷
const cleanFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSSZ",
  }),
  // 명시적으로 colorize 비활성화 (winston.format.uncolorize()는 사용하지 않음)
  plainTextFormat
);

const LOG_DIR = "/var/log/nginx-proxy-watch";
const logBaseConfig = {
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 14, // 14일 보관
  tailable: true, // 로그 파일 로테이션 활성화
  zippedArchive: true, // 로그 압축 보관
  format: cleanFormat,
};

// 로그 디렉토리 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 기본 로거 생성 - 모든 출력에 순수 텍스트 포맷 사용
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "docker-event-watcher" },
  exitOnError: false,
  format: cleanFormat, // 전역적으로 기본 포맷 설정
  transports: [
    // 콘솔 출력 - 색상 없는 순수 텍스트
    new winston.transports.Console(),

    // 모든 로그를 단일 파일에 저장 (OpenTelemetry 수집기용)
    new winston.transports.File({
      ...logBaseConfig,
      filename: `${LOG_DIR}/watcher.log`,
    }),

    // 각 레벨별 로그 파일
    new winston.transports.File({
      ...logBaseConfig,
      filename: `${LOG_DIR}/error.log`,
      level: "error",
    }),

    new winston.transports.File({
      ...logBaseConfig,
      filename: `${LOG_DIR}/debug.log`,
      level: "debug",
    }),
  ],
});

// 로거 확장 - 유틸리티 함수 추가
const logger = baseLogger as ExtendedLogger;

// Docker 이벤트 로깅 함수
logger.dockerEvent = (
  eventType: string,
  containerId: string,
  details: Record<string, any> = {}
) => {
  logger.info(`Docker 이벤트 감지: ${eventType}`, {
    operation: "docker_event",
    eventType,
    containerId,
    ...details,
  });
};

// 컨테이너 상태 변경 로깅 함수
logger.containerState = (
  containerId: string,
  state: string,
  details: Record<string, any> = {}
) => {
  logger.info(`컨테이너 상태 변경: ${state}`, {
    operation: "container_state_change",
    containerId,
    state,
    ...details,
  });
};

// Nginx 설정 변경 로깅 함수
logger.nginxConfig = (
  action: string,
  configPath: string,
  details: Record<string, any> = {}
) => {
  logger.info(`Nginx 설정 ${action}`, {
    operation: "nginx_config",
    action,
    configPath,
    ...details,
  });
};

// 프로세스 이벤트 핸들러
process.on("exit", () => {
  logger.info("Docker 모니터링 서비스 종료");
});

process.on("uncaughtException", (error: Error) => {
  logger.error("처리되지 않은 예외 발생", {
    error: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("처리되지 않은 Promise 거부", { reason });
});

logger.info("로깅 시스템 초기화 완료");

export { logger };
