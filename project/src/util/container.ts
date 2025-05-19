import { ContainerInspectInfo } from "dockerode";
import { logger } from "./logging";

/**
 * 컨테이너의 IP 주소를 반환하는 함수
 * 여러 네트워크 소스를 시도하고 유효한 IP를 반환함
 */
export const getContainerIP = (info: ContainerInspectInfo): string => {
  console.info("getContainerIP", info);
  // 1. 기본 IP 주소 확인 (이전 버전 호환성)
  if (
    info?.NetworkSettings?.IPAddress &&
    info.NetworkSettings.IPAddress.trim() !== ""
  ) {
    logger.debug(
      `컨테이너 IP 주소를 기본 NetworkSettings에서 찾음: ${info.NetworkSettings.IPAddress}`,
      {
        containerId: info.Id,
        containerName: info.Name,
      }
    );
    return info.NetworkSettings.IPAddress;
  }

  // 2. 네트워크 객체에서 IP 추출 (신규 Docker 버전)
  if (info?.NetworkSettings?.Networks) {
    const networks = Object.values(info.NetworkSettings.Networks);

    // 유효한 IP를 가진 첫 번째 네트워크 사용
    for (const network of networks) {
      if (network.IPAddress && network.IPAddress.trim() !== "") {
        logger.debug(
          `컨테이너 IP 주소를 Networks 객체에서 찾음: ${network.IPAddress}`,
          {
            containerId: info.Id,
            containerName: info.Name,
            networkName: network.NetworkID,
          }
        );
        return network.IPAddress;
      }
    }
  }

  // 3. 컨테이너 상태 확인 (실행 중인지 확인)
  if (info?.State?.Status !== "running") {
    logger.warn(
      `실행 중이 아닌 컨테이너의 IP 주소를 요청함 (상태: ${info?.State?.Status})`,
      {
        containerId: info.Id,
        containerName: info.Name,
      }
    );
    // 중지된 컨테이너는 빈 문자열 반환하여 상위 로직에서 처리되도록 함
    return "";
  }

  // 4. 대체 IP로 로컬호스트 반환 (긴급 폴백) - 실행 중인 컨테이너만 해당
  logger.warn(
    `컨테이너 ${info.Name}(${info.Id})의 IP 주소를 찾을 수 없습니다. 빈 문자열 반환`,
    {
      container: {
        id: info.Id,
        name: info.Name,
        image: info.Image,
        state: info.State?.Status,
      },
      networkSettings: JSON.stringify(info.NetworkSettings, null, 2),
    }
  );
  return "";
};
