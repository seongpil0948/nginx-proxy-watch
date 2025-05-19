import { ContainerInfo } from "dockerode";
import { docker } from "./config";
import { makeFiles, getContainerEnv, logger } from "./util";
import { serverListState } from "./state";
import { processContainerConfig } from "./util/container-config";

export const initWatch = async (
  containers?: ContainerInfo[]
): Promise<void> => {
  if (!containers || containers.length === 0) {
    logger.info("실행 중인 컨테이너가 없습니다.");
    return;
  }

  logger.info(
    `${containers.length}개의 실행 중인 컨테이너 발견, 설정 초기화 중...`
  );

  try {
    const validContainers = [];

    for (const container of containers) {
      try {
        const containerObj = docker.getContainer(container.Id);
        const info = await containerObj.inspect();
        const env = getContainerEnv(info?.Config.Env);

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
