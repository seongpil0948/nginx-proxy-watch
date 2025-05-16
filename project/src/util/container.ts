import { ContainerInspectInfo } from "dockerode";
import { logger } from "./logging";

export const getContainerIP = (info: ContainerInspectInfo): string => {
  // 1. 기존 방식 시도 (이전 버전 호환성)
  if (info?.NetworkSettings?.IPAddress) {
    return info.NetworkSettings.IPAddress;
  }

  // 2. 네트워크 객체에서 IP 추출 (신규 Docker 버전)
  if (info?.NetworkSettings?.Networks) {
    const networks = Object.values(info.NetworkSettings.Networks);
    if (networks.length > 0 && networks[0].IPAddress) {
      return networks[0].IPAddress;
    }
  }

  // 3. 대체 IP로 로컬호스트 반환 (긴급 폴백)
  logger.warn(
    `컨테이너 ${info.Name}::${info.Image}::${info.Id}의 IP 주소를 찾을 수 없습니다. 로컬호스트로 대체합니다.`,
    JSON.stringify(info, null, 2)
  );
  return "127.0.0.1";
};
