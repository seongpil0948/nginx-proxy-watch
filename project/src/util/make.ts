import * as ejs from "ejs";
import _ from "lodash";
import { exec } from "child_process";

import { IContainerStatusItem } from "@interfaces/watcher";
import { writeFileSync, existsSync, unlink, mkdirSync } from "fs";
import { templates } from "../config";
import { serverListState } from "../state";
import { logger } from "./logging";

const hasValidNetworkEntries = (
  networkEntries: Array<{ ip?: string }>
): boolean => {
  if (!networkEntries || networkEntries.length === 0) {
    return false;
  }

  // 모든 네트워크 엔트리의 IP 주소 유효성 검사
  return networkEntries.every((entry) => {
    if (!entry.ip) return false;

    // ":포트번호" 패턴 확인
    const parts = entry.ip.split(":");
    return parts.length === 2 && parts[0] && parts[0] !== "";
  });
};

// makeUpstream 함수 수정
const makeUpstream = async (conItem: IContainerStatusItem): Promise<void> => {
  logger.debug(`Upstream 설정 생성 시작`, { conItem });
  if (!conItem.serverName) {
    logger.warn("serverName 없는 컨테이너 항목, Upstream 생성 건너뜀", {
      operation: "makeUpstream",
      containerData: conItem,
    });
    return;
  }

  const configPath = `${templates.upstream.TARGET_PATH}/${templates.upstream.PREFIX}${conItem.serverName}.conf`;
  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  try {
    // 유효한 네트워크 정보가 있는지 검증
    if (conItem.network.length > 0 && hasValidNetworkEntries(conItem.network)) {
      logger.debug(`Upstream 설정 생성 시작`, {
        operation: "makeUpstream",
        serverName: conItem.serverName,
        configPath,
      });

      // EJS 렌더링
      const rendered = await new Promise<string>((resolve, reject) => {
        ejs.renderFile(templates.upstream.PATH, conItem, {}, (err, str) => {
          if (err) reject(err);
          else resolve(str);
        });
      });

      // 파일 쓰기
      writeFileSync(configPath, rendered);
      logger.nginxConfig("생성", configPath, {
        serverName: conItem.serverName,
        type: "upstream",
      });
    } else {
      // 네트워크 정보가 유효하지 않은 경우 - 로그 상세화
      if (conItem.network.length > 0) {
        logger.warn(`유효하지 않은 네트워크 정보, Upstream 생성 건너뜀`, {
          operation: "makeUpstream",
          serverName: conItem.serverName,
          network: conItem.network,
        });
      }

      // 기존 설정 파일 제거 처리
      if (existsSync(configPath)) {
        logger.info(
          `유효하지 않은 네트워크 정보, Upstream 설정 파일 제거 시도`,
          {
            operation: "makeUpstream",
            serverName: conItem.serverName,
            configPath,
          }
        );
        unlink(configPath, (err) => {
          if (err) {
            logger.error(`Upstream 설정 파일 삭제 실패`, {
              operation: "makeUpstream_delete",
              serverName: conItem.serverName,
              configPath,
              error: err.message,
              stack: err.stack,
            });
          } else {
            logger.nginxConfig("삭제", configPath, {
              serverName: conItem.serverName,
              type: "upstream",
              reason: "Invalid network",
            });
          }
        });
      } else {
        logger.debug(`Upstream 설정 파일 없음, 삭제 건너뜀`, {
          operation: "makeUpstream",
          serverName: conItem.serverName,
          configPath,
        });
      }
    }

    // Nginx 로그 디렉토리 생성
    if (!existsSync(nginxLogPath)) {
      mkdirSync(nginxLogPath, { recursive: true });
      logger.debug(`Nginx 로그 디렉토리 생성`, {
        operation: "makeUpstream_logdir",
        path: nginxLogPath,
      });
    }
  } catch (error: any) {
    logger.error(`Upstream 설정 처리 중 오류`, {
      operation: "makeUpstream",
      serverName: conItem.serverName,
      configPath,
      error: error.message,
      stack: error.stack,
    });
  }
};

const makeVhost = async (conItem: IContainerStatusItem): Promise<void> => {
  // serverName 유효성 검사
  if (!conItem.serverName) {
    logger.warn("serverName이 없는 컨테이너 항목, Vhost 생성 건너뜀", {
      operation: "makeVhost",
      containerData: _.pick(conItem, ["host", "port"]),
    });
    return;
  }
  // host 정보 유효성 검사 (group host가 아닐 경우 serverName과 동일해야 함)
  if (!conItem.host) {
    logger.warn("host 정보가 없는 컨테이너 항목, Vhost 생성 건너뜀", {
      operation: "makeVhost",
      serverName: conItem.serverName,
    });
    return;
  }

  // 설정 파일 이름 결정 (그룹 호스트 여부에 따라)
  const configFileName =
    conItem.groupYn === "Y" ? conItem.host : conItem.serverName;

  // --- 템플릿 선택 로직 ---
  let templatePath: string;
  // 쿠키 라우팅 관련 정보가 있는지 확인 (routingCookieName과 routingMap 둘 다 필요하며, routingMap이 비어있지 않아야 함)
  if (
    conItem.routingCookieName &&
    conItem.routingMap &&
    Object.keys(conItem.routingMap).length > 0
  ) {
    // vhostCookie 템플릿 정의 확인
    if (!templates.vhostCookie || !templates.vhostCookie.PATH) {
      logger.error(
        `쿠키 라우팅 템플릿(vhostCookie) 경로가 정의되지 않았습니다. 기본 템플릿을 사용합니다.`,
        { operation: "makeVhost", serverName: conItem.serverName }
      );
      templatePath = templates.vhost.PATH; // 기본 템플릿으로 대체
    } else {
      templatePath = templates.vhostCookie.PATH; // 쿠키 라우팅 템플릿 경로 사용
      logger.debug(
        `${configFileName}에 쿠키 라우팅 적용, 템플릿: ${templatePath}`
      );
    }
  } else {
    templatePath = templates.vhost.PATH; // 기본 vhost 템플릿 경로 사용
  }
  // --- /템플릿 선택 로직 ---

  // 설정 파일 경로 정의 (vhost 디렉토리 사용)
  const configPath = `${templates.vhost.TARGET_PATH}/${templates.vhost.PREFIX}${configFileName}.conf`;
  // 로그 파일 경로 정의 (serverName 기준)
  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  try {
    // 네트워크 정보가 하나 이상 있을 때만 vhost 파일 생성 또는 업데이트
    if (conItem.network && conItem.network.length > 0) {
      logger.debug(
        `${configFileName}에 대한 Vhost 설정 생성/업데이트 시작 (템플릿: ${templatePath})`
      );

      // EJS 템플릿 렌더링 (선택된 templatePath 사용)
      const rendered = await new Promise<string>((resolve, reject) => {
        ejs.renderFile(templatePath, conItem, {}, (err, str) => {
          if (err) {
            logger.error(`EJS 템플릿 렌더링 실패: ${templatePath}`, {
              error: err,
            });
            reject(err); // 오류 발생 시 reject
          } else {
            resolve(str); // 성공 시 resolve
          }
        });
      });

      // 설정 파일 작성 (오류 처리 추가)
      try {
        writeFileSync(configPath, rendered);
        logger.nginxConfig("생성/업데이트", configPath, {
          serverName: conItem.serverName,
          type: "vhost",
          template: templatePath,
        });
      } catch (writeError: any) {
        logger.error(`Vhost 설정 파일 쓰기 실패: ${configPath}`, {
          error: writeError.message,
        });
        // 파일 쓰기 실패 시 Nginx 리로드 방지 등 추가 처리 고려
        return; // Vhost 생성 실패 시 종료
      }
    } else {
      // 네트워크 정보가 없으면 기존 vhost 파일 제거
      if (existsSync(configPath)) {
        logger.info(`네트워크 정보 없음, Vhost 설정 파일 제거 시도`, {
          operation: "makeVhost_delete",
          serverName: conItem.serverName,
          configPath,
        });
        unlink(configPath, (err) => {
          // 비동기 삭제, 콜백에서 로깅
          if (err) {
            logger.error(`Vhost 설정 파일 삭제 실패`, {
              operation: "makeVhost_delete_error",
              serverName: conItem.serverName,
              configPath,
              error: err.message,
            });
          } else {
            logger.nginxConfig("삭제", configPath, {
              serverName: conItem.serverName,
              type: "vhost",
              reason: "No network",
            });
            // 파일 삭제 후 Nginx 리로드가 필요할 수 있음 (makeFiles 함수에서 처리)
          }
        });
      } else {
        logger.debug(`Vhost 설정 파일 없음, 삭제 건너뜀`, {
          operation: "makeVhost_noop_delete",
          serverName: conItem.serverName,
          configPath,
        });
      }
    }

    // Nginx 로그 디렉토리 생성 (항상 시도, 오류는 경고로 처리)
    try {
      if (!existsSync(nginxLogPath)) {
        mkdirSync(nginxLogPath, { recursive: true });
        logger.debug(`Nginx 로그 디렉토리 생성`, {
          operation: "makeVhost_logdir",
          path: nginxLogPath,
        });
      }
    } catch (mkdirError: any) {
      logger.warn(
        `Nginx 로그 디렉토리 생성 실패 (무시 가능): ${nginxLogPath}`,
        { error: mkdirError.message }
      );
    }
  } catch (error: any) {
    // EJS 렌더링 오류 또는 기타 예상치 못한 오류 처리
    logger.error(`Vhost 설정 처리 중 오류 발생`, {
      operation: "makeVhost_error",
      serverName: conItem.serverName,
      configPath,
      template: templatePath, // 사용된 템플릿 정보 로깅
      error: error.message,
      stack: error.stack,
    });
  }
};

// Location 설정 파일 생성 함수 개선
const makeLocation = async (conItem: IContainerStatusItem): Promise<void> => {
  if (!conItem.serverName) {
    logger.warn("serverName이 없는 컨테이너 항목을 무시합니다.");
    return;
  }

  const locationDir = `${templates.location.TARGET_PATH}${conItem.host}`;
  const configPath = `${locationDir}/${templates.location.PREFIX}${conItem.serverName}.conf`;
  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  try {
    if (conItem.network.length > 0) {
      logger.debug(`${conItem.serverName}에 대한 Location 설정 생성 시작`);

      // Location 디렉토리 생성 (존재하지 않는 경우)
      if (!existsSync(locationDir)) {
        mkdirSync(locationDir, { recursive: true });
        logger.debug(`${locationDir} 디렉토리 생성 완료`);
      }

      // EJS 템플릿 렌더링을 Promise로 변환
      const rendered = await new Promise<string>((resolve, reject) => {
        ejs.renderFile(templates.location.PATH, conItem, {}, (err, str) => {
          if (err) reject(err);
          else resolve(str);
        });
      });

      // 설정 파일 작성
      writeFileSync(configPath, rendered);
      logger.info(`${configPath} 설정 파일 생성 완료`);
    } else {
      // 네트워크가 없으면 설정 파일 제거
      if (existsSync(configPath)) {
        unlink(configPath, (err) => {
          if (err) {
            logger.error(`${configPath} 삭제 실패: ${err.message}`);
          } else {
            logger.info(`${configPath} 삭제 완료`);
          }
        });
      } else {
        logger.debug(`${configPath} 파일이 존재하지 않아 삭제를 건너뜁니다.`);
      }
    }

    // Nginx 로그 디렉토리 생성
    if (!existsSync(nginxLogPath)) {
      mkdirSync(nginxLogPath, { recursive: true });
      logger.debug(`${nginxLogPath} 로그 디렉토리 생성 완료`);
    }
  } catch (error) {
    logger.error(`Location 설정 파일 생성 중 오류: ${error}`);
  }
};

const nginxReload = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    logger.nginxConfig("재로드 시도", "N/A", { operation: "nginxReload" });

    // 먼저 nginx 설정 테스트 실행
    exec("nginx -t", (testError, testStdout, testStderr) => {
      if (testError) {
        // 설정 테스트 실패
        logger.error(`Nginx 설정 테스트 실패`, {
          operation: "nginxReload_test",
          action: "설정 테스트 실패",
          error: testError.message,
          stderr: testStderr,
        });

        // 오류가 upstream 관련 문제인지 확인
        if (testStderr.includes("no host in upstream")) {
          logger.error(`Upstream 설정 오류 감지됨, 문제 파일 검색 필요`, {
            operation: "nginxReload_test",
          });
        }

        reject(testError);
        return;
      }

      // 설정 테스트 성공 시 재로드 진행
      exec("nginx -s reload", (error, stdout, stderr) => {
        if (stdout) {
          logger.debug(`Nginx 재로드 stdout`, {
            operation: "nginxReload",
            output: stdout,
          });
        }

        if (stderr) {
          logger.debug(`Nginx 재로드 stderr`, {
            operation: "nginxReload",
            output: stderr,
          });
        }

        if (error) {
          logger.error(`Nginx 재로드 실패`, {
            operation: "nginxReload",
            action: "재로드 실패",
            error: error.message,
            stack: error.stack,
            stderr,
          });
          reject(error);
        } else {
          logger.nginxConfig("재로드 성공", "N/A", {
            operation: "nginxReload",
          });
          resolve();
        }
      });
    });
  });
};

// 모든 설정 파일 생성 함수 개선
export const makeFiles = async (): Promise<void> => {
  logger.info("Nginx 설정 파일 생성/갱신 시작", { operation: "makeFiles" });
  try {
    const serverList = serverListState.get();
    const promises = [];
    const serverNames = Object.keys(serverList);

    logger.info(`처리 대상 서버 ${serverNames.length}개`, {
      operation: "makeFiles",
      servers: serverNames,
    });

    for (const key in serverList) {
      const val = serverList[key];
      // 각 make 함수 호출 시 로깅은 해당 함수 내부에서 처리
      promises.push(makeUpstream(val));

      if (val.locationPath) {
        promises.push(makeLocation(val));
      }

      // isLocation이 'Y'가 아닌 경우 (즉, 메인 vhost 또는 group vhost)
      if (val.isLocation !== "Y") {
        // group host인 경우, 동일 host에 대해 vhost 생성이 중복될 수 있음.
        // makeVhost 내부에서 파일 존재 여부 등으로 처리하거나, 여기서 중복 호출 방지 로직 추가 필요
        // 예시: group host 별로 한 번만 vhost 생성하도록 관리
        // (간단하게는 val.groupYn === 'Y' && val.host === key 또는 특정 플래그로 관리)
        // 여기서는 일단 모든 non-location에 대해 호출한다고 가정
        promises.push(makeVhost(val));
      }
    }

    await Promise.all(promises);
    logger.info("모든 설정 파일 생성/갱신 완료", {
      operation: "makeFiles",
      count: serverNames.length,
    });

    // Nginx 재시작 (내부에서 로깅 처리)
    await nginxReload();
  } catch (error: any) {
    logger.error(`설정 파일 생성/갱신 중 오류`, {
      operation: "makeFiles",
      error: error.message,
      stack: error.stack,
    });
    // 오류 발생 시 Nginx 리로드를 건너뛸지 여부 결정 필요
  }
};
