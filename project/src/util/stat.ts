import { ContainerStats } from "dockerode";
import { docker } from "../config";
import { logger } from "./logging";

// CPU 사용량 계산 함수
export const calculateCpuUsage = (stats: ContainerStats): number => {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  if (systemDelta > 0 && cpuDelta > 0) {
    const cpuCount =
      stats.cpu_stats.online_cpus ||
      (stats.cpu_stats.cpu_usage.percpu_usage
        ? stats.cpu_stats.cpu_usage.percpu_usage.length
        : 1);

    return (cpuDelta / systemDelta) * cpuCount * 100.0;
  }

  return 0;
};

// 메모리 사용량 계산 함수
export const calculateMemoryUsage = (stats: ContainerStats): number => {
  const memoryUsage = stats.memory_stats.usage;
  const memoryLimit = stats.memory_stats.limit;

  if (memoryUsage && memoryLimit) {
    return (memoryUsage / memoryLimit) * 100.0;
  }

  return 0;
};

export const collectContainerStats = async (
  containerId: string
): Promise<ContainerStats> => {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });
    // debug 레벨 사용 및 컨텍스트 추가
    logger.debug(`컨테이너 통계 수집 성공`, {
      operation: "collectContainerStats",
      containerId,
    });
    return stats;
  } catch (error: any) {
    // 에러 로깅 개선: 에러 객체와 컨텍스트 포함
    logger.error(`컨테이너 통계 수집 실패`, {
      operation: "collectContainerStats",
      containerId,
      error: error.message,
      stack: error.stack, // winston format에서 처리하지만 명시적으로 포함 가능
    });
    throw error;
  }
};
