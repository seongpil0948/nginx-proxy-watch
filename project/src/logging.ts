const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const path = require('path');

// 로그 포맷 정의
const logFormat = printf(({ level, message, timestamp }: any) => {
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
});

// 로거 생성
export const logger = createLogger({
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    logFormat
  ),
  transports: [
    // 콘솔 출력
    new transports.Console(),
    // 접근 로그 파일
    new transports.File({ 
      filename: '/var/log/docker-event-watcher/access.log',
      level: 'info'
    }),
    // 에러 로그 파일
    new transports.File({ 
      filename: '/var/log/docker-event-watcher/error.log',
      level: 'error'
    }),
    // 디버그 로그 파일
    new transports.File({ 
      filename: '/var/log/docker-event-watcher/debug.log',
      level: 'debug'
    })
  ]
});

module.exports = logger;