// project/src/index.ts
import _ from "lodash";
import { logger } from "./util";

import { docker, MONITORED_EVENTS } from "./config";
import { scheduleHealthCheck } from "./health";
import { initWatch } from "./watch";
import { dockerEventHandler } from "./event-handler";
import { startApiServer } from "./api-server"; // 추가된 import

// 메인 실행 부분
async function main() {
  try {
    logger.info("Docker 모니터링 서비스 시작");
    await initWatch();

    // 다양한 Docker 이벤트 감시 설정
    MONITORED_EVENTS.forEach((eventType) => {
      docker.getEvents(
        { filters: { event: [eventType] } },
        dockerEventHandler(eventType)
      );
      logger.info(`Docker ${eventType} 이벤트 모니터링 시작`);
    });

    // 기존 헬스체크 스케줄링
    scheduleHealthCheck(1);

    // API 서버 시작 (추가됨)
    const apiPort = process.env.API_PORT
      ? parseInt(process.env.API_PORT, 10)
      : 8080;
    await startApiServer(apiPort);

    logger.info("모든 초기화 완료, Docker 이벤트 모니터링 중...");
  } catch (error) {
    logger.error(`서비스 시작 중 오류 발생: ${error}`);
    process.exit(1);
  }
}

// 애플리케이션 시작
main().catch((error) => {
  logger.error(`예상치 못한 오류 발생: ${error}`);
  process.exit(1);
});
