import * as winston from 'winston';
import { TransformableInfo } from 'logform';
import * as fs from 'fs';

// Winston의 TransformableInfo를 확장한 로그 인터페이스
interface ExtendedTransformableInfo extends TransformableInfo {
  [key: string]: any;
}

// 확장된 로거 인터페이스 정의
interface ExtendedLogger extends winston.Logger {
  dockerEvent: (eventType: string, containerId: string, details?: Record<string, any>) => void;
  containerState: (containerId: string, state: string, details?: Record<string, any>) => void;
  nginxConfig: (action: string, configPath: string, details?: Record<string, any>) => void;
}

// 로그 포맷 정의 - Winston의 TransformableInfo 타입 사용
const logFormat = winston.format.printf((info: ExtendedTransformableInfo) => {
  const { level, message, timestamp, ...metadata } = info;
  let metaStr = '';
  
  // 에러 스택 처리
  if (metadata.stack) {
    metaStr = `\n${metadata.stack}`;
  } 
  // 일반 메타데이터 처리 - JSON 형식으로 추가
  else if (Object.keys(metadata).length > 0 && metadata.message === undefined) {
    metaStr = ` | ${JSON.stringify(metadata)}`;
  }
  
  // [시간] [로그레벨] 메시지 형식 - OpenTelemetry regex_parser와 호환
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
});

// 로그 저장 경로 설정 - OpenTelemetry 경로와 일치시킴
const LOG_DIR = '/data/nginx-proxy-watch/logs';

// 로그 파일 설정
const logConfiguration = {
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 14,              // 14일 보관
  tailable: true,            // 로그 파일 로테이션 활성화
  zippedArchive: true,       // 로그 압축 보관
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    logFormat
  )
};

// 로그 디렉토리 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 기본 로거 생성
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'docker-event-watcher' },
  exitOnError: false,
  transports: [
    // 콘솔 출력
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        logFormat
      )
    }),
    
    // 모든 로그를 단일 파일에 저장 (OpenTelemetry 수집기용)
    new winston.transports.File({ 
      ...logConfiguration,
      filename: `${LOG_DIR}/watcher.log`,
    }),
    
    // 각 레벨별 로그 파일
    new winston.transports.File({ 
      ...logConfiguration,
      filename: `${LOG_DIR}/error.log`,
      level: 'error'
    }),
    
    new winston.transports.File({ 
      ...logConfiguration,
      filename: `${LOG_DIR}/debug.log`,
      level: 'debug'
    })
  ]
});

// 로거 확장 - 유틸리티 함수 추가
const logger = baseLogger as ExtendedLogger;

// Docker 이벤트 로깅 함수
logger.dockerEvent = (eventType: string, containerId: string, details: Record<string, any> = {}) => {
  logger.info(`Docker ${eventType} 이벤트`, {
    eventType,
    containerId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// 컨테이너 상태 변경 로깅 함수
logger.containerState = (containerId: string, state: string, details: Record<string, any> = {}) => {
  logger.info(`컨테이너 ${containerId} 상태 변경: ${state}`, {
    containerId,
    state,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Nginx 설정 변경 로깅 함수
logger.nginxConfig = (action: string, configPath: string, details: Record<string, any> = {}) => {
  logger.info(`Nginx 설정 ${action}: ${configPath}`, {
    action,
    configPath,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// 프로세스 종료 시 로깅
process.on('exit', () => {
  logger.info('Docker 모니터링 서비스 종료');
});

// 예상치 못한 예외 로깅
process.on('uncaughtException', (error: Error) => {
  logger.error('처리되지 않은 예외 발생', { 
    error: error.message, 
    stack: error.stack 
  });
});

// 거부된 Promise 로깅
process.on('unhandledRejection', (reason: any) => {
  logger.error('처리되지 않은 Promise 거부', { reason });
});

logger.info('로깅 시스템 초기화 완료');

export { logger };