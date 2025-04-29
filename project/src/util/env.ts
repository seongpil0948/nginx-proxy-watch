import { ContainerEnv } from "@interfaces/watcher";
import _ from "lodash";
import { logger } from "./logging";

const ENV_PREFIX = "VIRTUAL_";

/**
 * "key1:value1,key2:value2" 형식의 문자열을 객체로 변환
 */
export const parseMapString = (
  mapString?: string
): { [key: string]: string } | undefined => {
  if (!mapString) return undefined;
  try {
    return mapString.split(",").reduce((acc, pair) => {
      const [key, value] = pair.split(":");
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {} as { [key: string]: string });
  } catch (error: any) {
    // any 타입 사용 또는 Error 타입 명시
    logger.warn(`맵 문자열 파싱 실패: ${mapString}`, { error: error.message });
    return undefined;
  }
};

// --- getContainerEnv 함수 수정 ---
export const getContainerEnv = (envs?: string[]): ContainerEnv => {
  if (!envs) {
    logger.debug("환경변수가 없습니다. 기본값 사용");
    // ContainerEnv 타입에 맞게 반환 (watcher.d.ts 수정 필요)
    return { host: "", port: 80 } as ContainerEnv;
  }

  // reduce의 초기값을 Partial<ContainerEnv>로 설정
  const env = _.reduce<string, Partial<ContainerEnv>>(
    envs,
    (prev, next) => {
      const pos = next.indexOf("=");
      if (pos === -1) return prev;

      const key = next.substring(0, pos);
      const value = next.substring(pos + 1);

      if (key.startsWith(ENV_PREFIX)) {
        const normalizedKey = key.substring(ENV_PREFIX.length).toLowerCase();
        logger.debug(`환경변수 파싱: ${normalizedKey}=${value}`, {
          operation: "getContainerEnv",
          key: normalizedKey,
        });

        // --- 쿠키 라우팅 및 타입 처리 로직 ---
        switch (normalizedKey) {
          case "port":
            const portNumber = parseInt(value, 10);
            // 유효하지 않은 포트 번호면 기본값(80) 또는 다른 값 사용 고려
            return { ...prev, port: isNaN(portNumber) ? 80 : portNumber };
          case "routing_map":
          case "host_header_map":
            const parsedMap = parseMapString(value);
            // 파싱 성공 시에만 해당 키로 객체 저장
            return parsedMap ? { ...prev, [normalizedKey]: parsedMap } : prev;
          case "cert":
            // cert 값은 'pem' 또는 'crt'만 유효하도록 처리 (선택적)
            if (value === "pem" || value === "crt") {
              return { ...prev, [normalizedKey]: value };
            }
            logger.warn(`유효하지 않은 cert 값: ${value}. 무시됩니다.`);
            return prev;
          // 다른 boolean 값 (예: VIRTUAL_HTTPS_REDIRECT=true) 처리 로직 추가 가능
          // case 'https_redirect':
          //   return { ...prev, [normalizedKey]: value.toLowerCase() === 'true' };
          default:
            // 나머지 환경변수는 문자열로 저장
            return { ...prev, [normalizedKey]: value };
        }
      }
      return prev;
    },
    {} // 초기값 빈 객체
  );

  return {
    host: env.host || "",
    port: env.port || 80,
    https: env.https,
    ssl: env.ssl,
    conf: env.conf,
    location: env.location,
    is_location: env.is_location,
    cert: env.cert as "pem" | "crt" | undefined,
    group_host: env.group_host,
    location_path: env.location_path,
    cookie_name: env.cookie_name,
    routing_map: env.routing_map as { [key: string]: string } | undefined,
    default_upstream: env.default_upstream,
    host_header_map: env.host_header_map as
      | { [key: string]: string }
      | undefined,
  };
};
