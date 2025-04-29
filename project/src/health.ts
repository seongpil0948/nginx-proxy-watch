import { docker } from "./config";
import { logger } from "./util/logging";
import {
  collectContainerStats,
  calculateCpuUsage,
  calculateMemoryUsage,
} from "./util/stat";

// 컨테이너 헬스체크 함수 추가
const containerHealthCheck = async (): Promise<void> => {
  try {
    const containers = await docker.listContainers({ all: true });
    logger.info(`헬스체크: ${containers.length}개 컨테이너 발견`);

    const runningContainers = containers.filter((c) => c.State === "running");
    const stoppedContainers = containers.filter((c) => c.State !== "running");

    logger.info(
      `헬스체크 결과: ${runningContainers.length}개 실행 중, ${stoppedContainers.length}개 중지됨`
    );

    // 각 컨테이너의 기본 상태 정보 로깅
    for (const container of runningContainers) {
      try {
        const stats = await collectContainerStats(container.Id);
        const cpuUsage = calculateCpuUsage(stats);
        const memoryUsage = calculateMemoryUsage(stats);

        logger.debug(`컨테이너 ${container.Id} 상태:`, {
          name: container.Names[0],
          image: container.Image,
          cpuPercent: cpuUsage.toFixed(2) + "%",
          memoryPercent: memoryUsage.toFixed(2) + "%",
        });
      } catch (error) {
        logger.warn(`컨테이너 ${container.Id} 상태 확인 실패: ${error}`);
      }
    }
  } catch (error) {
    logger.error(`헬스체크 실패: ${error}`);
  }
};

// 주기적인 컨테이너 헬스체크 설정
export const scheduleHealthCheck = (
  intervalMinutes: number
): NodeJS.Timeout => {
  logger.info(`${intervalMinutes}분 간격으로 컨테이너 헬스체크 스케줄링`);
  return setInterval(containerHealthCheck, intervalMinutes * 60 * 1000);
};
