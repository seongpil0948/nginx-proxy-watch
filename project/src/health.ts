// project/src/health.ts
import {
  collectContainerStats,
  calculateCpuUsage,
  calculateMemoryUsage,
  logger,
} from "./util";
import { serverListState } from "./state";
import { processContainerConfig } from "./util/container-config";
import { makeFiles } from "./util/make";
import { runningTargetContainers } from "./util/container-management";

// 컨테이너 헬스체크 함수 개선
const containerHealthCheck = async (): Promise<void> => {
  try {
    // 1. 타겟 컨테이너(VIRTUAL_HOST 설정된) 목록 가져오기
    const targetContainers = await runningTargetContainers();

    logger.info(`헬스체크: ${targetContainers.length}개 타겟 컨테이너 발견`);

    // 2. serverListState에서 현재 관리 중인 서버 목록 가져오기
    const currentServerList = serverListState.get();
    const managedContainerIds = new Set();

    // 현재 관리 중인 컨테이너 ID 수집
    Object.values(currentServerList).forEach((server) => {
      server.network.forEach((network) => {
        if (network.dockerId) {
          managedContainerIds.add(network.dockerId);
        }
      });
    });

    // 3. 누락된 컨테이너 식별 및 처리
    const missingContainers = [];
    let configUpdateNeeded = false;

    for (const { container, info, env } of targetContainers) {
      // 이미 관리 중인 컨테이너는 건너뛰기
      if (managedContainerIds.has(container.Id)) {
        continue;
      }

      // 컨테이너 설정 생성 및 추가
      const containerConfig = processContainerConfig(container.Id, info, env);
      if (containerConfig) {
        missingContainers.push({
          id: container.Id,
          name: info.Name,
          config: containerConfig,
        });

        // serverListState에 추가
        serverListState.set(containerConfig);
        configUpdateNeeded = true;

        logger.warn(`누락된 컨테이너 감지 및 복구: ${container.Id}`, {
          operation: "containerHealthCheck",
          containerId: container.Id,
          containerName: info.Name,
          virtualHost: env.host,
        });
      }
    }

    // 4. 누락된 컨테이너가 있으면 nginx 설정 업데이트
    if (configUpdateNeeded) {
      logger.info(
        `${missingContainers.length}개의 누락된 컨테이너 발견, nginx 설정 업데이트 시작`,
        {
          operation: "containerHealthCheck_update",
          missingContainers: missingContainers.map((c) => ({
            id: c.id,
            name: c.name,
          })),
        }
      );

      try {
        await makeFiles();
        logger.info("누락된 컨테이너에 대한 nginx 설정 업데이트 완료");
      } catch (error) {
        logger.error(`nginx 설정 업데이트 실패: ${error}`);
      }
    }

    // 5. 기존 컨테이너 상태 체크 (원래 기능 유지)
    for (const { container } of targetContainers) {
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
  intervalSeconds: number
): NodeJS.Timeout => {
  logger.info(
    `${intervalSeconds}초 간격으로 컨테이너 헬스체크 및 설정 검증 스케줄링`
  );
  return setInterval(containerHealthCheck, intervalSeconds * 1000);
};
