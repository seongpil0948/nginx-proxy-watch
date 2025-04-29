import _ from "lodash";
import { ContainerInfo } from "dockerode";
import { logger } from "./util";

import { docker, MONITORED_EVENTS } from "./config";
import { scheduleHealthCheck } from "./health";
import { initWatch } from "./watch";
import { dockerEventHandler } from "./event-handler";

// 메인 실행 부분
async function main() {
  try {
    logger.info("Docker 모니터링 서비스 시작");

    // 현재 실행 중인 컨테이너 목록 가져오기
    const containers = await new Promise<ContainerInfo[]>((resolve, reject) => {
      docker.listContainers(
        { all: true, filters: { status: ["running"] } },
        (err, containers) => {
          if (err) {
            reject(err);
          } else {
            resolve(containers || []);
          }
        }
      );
    });

    await initWatch(containers);

    // 다양한 Docker 이벤트 감시 설정
    MONITORED_EVENTS.forEach((eventType) => {
      docker.getEvents(
        { filters: { event: [eventType] } },
        dockerEventHandler(eventType)
      );
      logger.info(`Docker ${eventType} 이벤트 모니터링 시작`);
    });

    scheduleHealthCheck(5);

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
