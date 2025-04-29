import { ContainerInfo } from "dockerode";
import { existsSync } from "fs";
import { docker, LOCATION_POSTFIX } from "./config";
import { makeFiles } from "./util/make";
import { serverListState } from "./state";
import { getContainerEnv } from "./util/env";
import { logger } from "./util/logging";

// 초기 컨테이너 감시 설정 함수
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
    await Promise.all(
      containers.map(async (container) => {
        try {
          const containerObj = docker.getContainer(container.Id);
          const info = await containerObj.inspect();

          const env = getContainerEnv(info?.Config.Env);
          const ip = info?.NetworkSettings.IPAddress;

          if (!env.host) {
            logger.debug(
              `컨테이너 ${container.Id}의 VIRTUAL_HOST 환경변수가 없습니다.`
            );
            return;
          }

          const locationList = env.location
            ?.split(",")
            .map((locInfo) => {
              const locData = locInfo.split(":");
              if (locData.length === 2) {
                return {
                  host: `${locData[0]}${LOCATION_POSTFIX}`,
                  path: locData[1],
                };
              }
              return undefined;
            })
            .filter((item) => !!item) as
            | {
                host: string;
                path: string;
              }[]
            | undefined;

          const serverName = `${env.host}${
            env.is_location?.toUpperCase() === "Y" ? LOCATION_POSTFIX : ""
          }${env.group_host ? "_" + env.location_path : ""}`;

          serverListState.set({
            serverName,
            host: env.group_host || env.host,
            port: env.port || 80,
            network: [
              {
                dockerId: container.Id,
                ip: `${ip}:${env.port}`,
              },
            ],
            isLocation: env.is_location?.toUpperCase(),
            location: locationList,
            sslCert:
              env.cert === "pem"
                ? `/etc/nginx/certs/${
                    env.ssl || env.group_host || env.host
                  }_crt.pem`
                : `/etc/nginx/certs/${
                    env.ssl || env.group_host || env.host
                  }.crt`,
            sslKey:
              env.cert === "pem"
                ? `/etc/nginx/certs/${
                    env.ssl || env.group_host || env.host
                  }_key.pem`
                : `/etc/nginx/certs/${
                    env.ssl || env.group_host || env.host
                  }.key`,
            https:
              env.cert === "pem"
                ? existsSync(
                    `/etc/nginx/certs/${
                      env.ssl || env.group_host || env.host
                    }_crt.pem`
                  ) &&
                  existsSync(
                    `/etc/nginx/certs/${
                      env.ssl || env.group_host || env.host
                    }_key.pem`
                  )
                : existsSync(
                    `/etc/nginx/certs/${
                      env.ssl || env.group_host || env.host
                    }.crt`
                  ) &&
                  existsSync(
                    `/etc/nginx/certs/${
                      env.ssl || env.group_host || env.host
                    }.key`
                  ),
            groupYn: env.group_host ? "Y" : "N",
            locationPath: env.location_path,
          });

          logger.info(`컨테이너 ${container.Id} (${serverName}) 초기화 완료`);
        } catch (error) {
          logger.error(`컨테이너 ${container.Id} 초기화 중 오류: ${error}`);
        }
      })
    );

    logger.info("모든 컨테이너 초기화 완료, 설정 파일 생성 중...");
    await makeFiles();
  } catch (error) {
    logger.error(`초기화 중 오류 발생: ${error}`);
  }
};
