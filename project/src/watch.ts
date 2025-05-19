// project/src/watch.ts
import { makeFiles, logger } from "./util";
import { serverListState } from "./state";
import { processContainerConfig } from "./util/container-config";
import { runningTargetContainers } from "./util/container-management";

export const initWatch = async (): Promise<void> => {
  try {
    // 새로운 함수를 사용하여 타겟 컨테이너 가져오기
    const targetContainers = await runningTargetContainers();

    if (targetContainers.length === 0) {
      logger.info("실행 중인 타겟 컨테이너가 없습니다.");
      return;
    }

    logger.info(
      `${targetContainers.length}개의 실행 중인 타겟 컨테이너 발견, 설정 초기화 중...`
    );

    const validContainers = [];

    for (const { container, info, env } of targetContainers) {
      try {
        // 개선된 컨테이너 설정 처리 함수 사용
        const containerConfig = processContainerConfig(container.Id, info, env);

        if (containerConfig) {
          serverListState.set(containerConfig);
          logger.info(
            `컨테이너 ${container.Id} (${containerConfig.serverName}) 초기화 완료`
          );
          validContainers.push(containerConfig);
        }
      } catch (error) {
        logger.error(`컨테이너 ${container.Id} 초기화 중 오류: ${error}`);
      }
    }

    logger.info(
      `${validContainers.length}개 컨테이너 초기화 완료, 설정 파일 생성 중...`
    );
    await makeFiles();
  } catch (error) {
    logger.error(`초기화 중 오류 발생: ${error}`);
  }
};
