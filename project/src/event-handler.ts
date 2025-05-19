import _ from "lodash";
import ReadableStream = NodeJS.ReadableStream;
import { existsSync } from "fs";
import {
  logger,
  getContainerEnv,
  calculateCpuUsage,
  calculateMemoryUsage,
  collectContainerStats,
  formatBytes,
  makeFiles,
} from "./util";
import { docker, LOCATION_POSTFIX } from "./config";
import { serverListState } from "./state";
import { processContainerConfig } from "./util/container-config";
import { getContainerNetworkInfo } from "./util/container";

export const dockerEventHandler =
  (eventType: string) => async (err: any, stream?: ReadableStream) => {
    // 구조화된 로깅 사용
    logger.info(`Docker 이벤트 스트림 시작`, {
      operation: "dockerEventHandler",
      eventType,
    });
    if (err || !stream) {
      logger.error(`Docker 이벤트 스트림 연결 실패`, {
        operation: "dockerEventHandler",
        eventType,
        error: err?.message || "스트림 없음",
        stack: err?.stack,
      });
      return;
    }

    stream.on("data", async (chunk) => {
      let data;
      try {
        data = JSON.parse(chunk.toString());

        logger.dockerEvent(eventType, data.id, {
          action: data.Action, // Docker 이벤트의 Action 필드
          actorId: data.actor?.ID,
          actorAttributes: data.actor?.Attributes,
          // 필요한 다른 data 필드 추가 가능
        });

        // 이벤트 타입별 처리 로직
        if (eventType === "start") {
          await handleContainerStart(data.id);
        } else if (
          eventType === "stop" ||
          eventType === "die" ||
          eventType === "destroy"
        ) {
          await handleContainerStop(data.id, eventType); // eventType 전달하여 로그에 활용
        } else {
          await handleOtherEvents(data.id, eventType);
        }
      } catch (error: any) {
        logger.error(`이벤트 처리 중 오류 발생`, {
          operation: "dockerEventHandler_data",
          eventType,
          containerId: data?.id, // 오류 발생 전 파싱된 ID가 있다면 포함
          rawChunk: chunk.toString(), // 원본 데이터 로깅
          error: error.message,
          stack: error.stack,
        });
      }
    });

    stream.on("error", (error) => {
      logger.error(`Docker 이벤트 스트림 오류`, {
        operation: "dockerEventHandler_stream_error",
        eventType,
        error: error.message,
        stack: error.stack,
      });
      // 재연결 로직
      setTimeout(() => {
        logger.info(`Docker 이벤트 스트림 재연결 시도`, {
          operation: "dockerEventHandler_reconnect",
          eventType,
        });
        docker.getEvents(
          { filters: { event: [eventType] } },
          dockerEventHandler(eventType)
        );
      }, 5000);
    });
  };

// 컨테이너 시작 이벤트 처리 함수
const handleContainerStart = async (containerId: string): Promise<void> => {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const env = getContainerEnv(info?.Config.Env);

    // 개선된 컨테이너 설정 처리 함수 사용
    const containerConfig = processContainerConfig(containerId, info, env);

    if (containerConfig) {
      // 서버 리스트 상태 업데이트
      serverListState.set(containerConfig);

      // 향상된 네트워크 정보 로깅
      const networkInfo = getContainerNetworkInfo(info.NetworkSettings);
      logger.info(`컨테이너 ${containerId} 네트워크 정보:`, {
        serverName: containerConfig.serverName,
        networks: networkInfo.networks,
      });

      // 컨테이너 리소스 정보 수집
      try {
        const stats = await collectContainerStats(containerId);
        const cpuUsage = calculateCpuUsage(stats);
        const memoryUsage = calculateMemoryUsage(stats);

        logger.info(`컨테이너 ${containerId} 리소스 사용량:`, {
          cpuPercent: cpuUsage.toFixed(2) + "%",
          memoryPercent: memoryUsage.toFixed(2) + "%",
          memoryUsed: formatBytes(stats.memory_stats.usage),
          memoryLimit: formatBytes(stats.memory_stats.limit),
        });
      } catch (error) {
        logger.warn(`컨테이너 통계 수집 실패: ${error}`);
      }

      // 설정 파일 생성
      await makeFiles();
    }
  } catch (error) {
    logger.error(`컨테이너 시작 이벤트 처리 중 오류: ${error}`);
  }
};
// 컨테이너 중지 이벤트 처리 함수
const handleContainerStop = async (
  containerId: string,
  eventType: string
): Promise<void> => {
  logger.info(`컨테이너 중지/소멸 처리 시작`, {
    operation: "handleContainerStop",
    containerId,
    eventType,
  });
  try {
    let containerName = "unknown";
    let containerImage = "unknown";
    let virtualHost = "unknown";

    // 중지된 컨테이너 정보 조회 시도 (실패 가능성 있음)
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      const env = getContainerEnv(info?.Config.Env);
      containerName = info.Name;
      containerImage = info.Config.Image;
      virtualHost = env.host || "호스트 없음";
      logger.info(`중지된 컨테이너 정보 확인`, {
        operation: "handleContainerStop_inspect",
        containerId,
        containerName,
        containerImage,
        virtualHost,
      });
    } catch (inspectError: any) {
      logger.warn(`중지된 컨테이너 정보 조회 실패`, {
        operation: "handleContainerStop_inspect_fail",
        containerId,
        error: inspectError.message,
      });
    }

    // 커스텀 로거 메서드 사용 (상태 변경)
    logger.containerState(containerId, eventType, {
      // 'stop', 'die', 'destroy' 등 실제 이벤트 타입 사용
      containerName, // 조회 성공 시 실제 이름, 실패 시 'unknown'
      containerImage,
      virtualHost,
    });

    serverListState.del(containerId);
    logger.info(`컨테이너 서버 목록에서 제거`, {
      operation: "handleContainerStop",
      containerId,
    });

    await makeFiles();
  } catch (error: any) {
    logger.error(`컨테이너 중지/소멸 처리 중 오류`, {
      operation: "handleContainerStop",
      containerId,
      eventType,
      error: error.message,
      stack: error.stack,
    });
  }
};

// 기타 이벤트 처리 함수
const handleOtherEvents = async (
  containerId: string,
  eventType: string
): Promise<void> => {
  logger.info(`기타 Docker 이벤트 처리 시작`, {
    operation: "handleOtherEvents",
    containerId,
    eventType,
  });
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    // 커스텀 로거 메서드 사용 또는 일반 info 사용
    logger.info(`컨테이너 이벤트 감지: ${eventType}`, {
      operation: "handleOtherEvents",
      containerId,
      eventType,
      containerName: info.Name,
      containerImage: info.Config.Image,
      containerState: info.State.Status,
    });

    // 특정 이벤트 타입에 대한 추가 로깅
    if (eventType === "pause") {
      logger.containerState(containerId, "paused", {
        containerName: info.Name,
      });
    } else if (eventType === "unpause") {
      logger.containerState(containerId, "resumed", {
        containerName: info.Name,
      });
    } else if (eventType === "restart") {
      logger.info(`컨테이너 재시작 감지, 시작 처리 호출`, {
        operation: "handleOtherEvents",
        containerId,
      });
      // 재시작은 내부적으로 stop -> start 흐름일 수 있으나, 명시적 restart 이벤트 처리
      await handleContainerStart(containerId); // 재시작 후 설정 적용
    }
    // 필요한 다른 이벤트 타입 처리 추가
  } catch (error: any) {
    // inspect 실패 등 오류 처리
    logger.warn(`${eventType} 이벤트 처리 중 오류 (정보 조회 등)`, {
      operation: "handleOtherEvents",
      containerId,
      eventType,
      error: error.message,
      // stack: error.stack // warn 레벨에서는 스택 제외 고려
    });
  }
};
