import _ from 'lodash';
import Dockerode, { ContainerInfo, ContainerInspectInfo, ContainerStats } from 'dockerode';
import * as ejs from 'ejs';
import { ContainerEnv, IContainersStatus, IContainerStatusItem, IServerList, IServerListInstance, ITemplates } from '@interfaces/watcher';
import { exec } from 'child_process';
import ReadableStream = NodeJS.ReadableStream;
import { access, constants, existsSync, mkdirSync, unlink, writeFileSync } from 'fs';
import { logger } from './logging';

// @ts-ignore
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
const NGINX_CONF_DIR = '/app/conf.d';
const ENV_PREFIX = 'VIRTUAL_';
const templates: ITemplates = {
  upstream: {
    PATH: '/app/templates/upstream-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/upstream.conf/`,
    PREFIX: 'upstream-',
  },
  vhost: {
    PATH: '/app/templates/vhost-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/vhost.conf/`,
    PREFIX: 'vhost-',
  },
  location: {
    PATH: '/app/templates/location-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/location.conf/`,
    PREFIX: 'location-',
  },
};
const LOCATION_POSTFIX = '_location';

// 모니터링할 Docker 이벤트 유형을 확장
const MONITORED_EVENTS = ['start', 'stop', 'die', 'destroy', 'create', 'pause', 'unpause', 'kill', 'restart'];

// 컨테이너 상태를 저장하는 싱글톤 인스턴스
const ServerListInstance = (): IServerListInstance => {
  let instance: IServerList;

  const ServerList = (): IServerList => {
    let sList = {} as IContainersStatus;

    return {
      set: (containerItem: IContainerStatusItem) => {
        logger.debug(`컨테이너 정보 추가/업데이트: ${containerItem.serverName}`);
        sList = {
          ...sList,
          [containerItem.serverName]: {
            ...sList[containerItem.serverName],
            ...containerItem,
            network: [...(sList[containerItem.serverName] ? sList[containerItem.serverName].network : []), ...containerItem.network],
          },
        };
      },
      get: () => {
        return sList;
      },
      del: (dockerId: string) => {
        logger.debug(`컨테이너 ID로 네트워크 정보 삭제: ${dockerId}`);
        sList = _.mapValues(sList, (item, key) => {
          return {
            ...sList[key],
            network: (sList[key] ? sList[key].network : []).filter((item) => item.dockerId !== dockerId),
          };
        });
      },
    };
  };

  return {
    getInstance: () => {
      if (!instance) {
        instance = ServerList();
      }
      return instance;
    },
  };
};

const serverListState = ServerListInstance().getInstance();

// 컨테이너 환경변수 파싱 함수 개선
const getContainerEnv = (envs?: string[]): ContainerEnv => {
  if (!envs) {
    logger.debug('환경변수가 없습니다. 기본값 사용');
    return { host: '', port: 80 } as ContainerEnv;
  }

  const env = _.reduce<string, ContainerEnv>(
    envs,
    (prev, next) => {
      const pos = next.indexOf('=');
      if (pos === -1) {
        return prev; // 잘못된 형식의 환경변수는 무시
      }

      const key = next.substring(0, pos);
      const value = next.substring(pos + 1);

      if (key.startsWith(ENV_PREFIX)) {
        const normalizedKey = key.substring(ENV_PREFIX.length).toLowerCase();
        logger.debug(`환경변수 파싱: ${normalizedKey}=${value}`, {
          operation: 'getContainerEnv',
          key: normalizedKey,
          // value: value // 필요시 값도 로깅 (민감 정보 주의)
        });
        return {
          ...prev,
          [normalizedKey]: value,
        };
      }

      return prev;
    },
    { host: '', port: 80 } as ContainerEnv
  );

  return env;
};

// 컨테이너 통계 수집 함수 추가
const collectContainerStats = async (containerId: string): Promise<ContainerStats> => {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });
    // debug 레벨 사용 및 컨텍스트 추가
    logger.debug(`컨테이너 통계 수집 성공`, { operation: 'collectContainerStats', containerId });
    return stats;
  } catch (error: any) {
    // 에러 로깅 개선: 에러 객체와 컨텍스트 포함
    logger.error(`컨테이너 통계 수집 실패`, {
      operation: 'collectContainerStats',
      containerId,
      error: error.message,
      stack: error.stack, // winston format에서 처리하지만 명시적으로 포함 가능
    });
    throw error;
  }
};

const dockerEventHandler = (eventType: string) => async (err: any, stream?: ReadableStream) => {
  // 구조화된 로깅 사용
  logger.info(`Docker 이벤트 스트림 시작`, { operation: 'dockerEventHandler', eventType });
  if (err || !stream) {
    logger.error(`Docker 이벤트 스트림 연결 실패`, {
      operation: 'dockerEventHandler',
      eventType,
      error: err?.message || '스트림 없음',
      stack: err?.stack,
    });
    return;
  }

  stream.on('data', async (chunk) => {
    let data;
    try {
      data = JSON.parse(chunk.toString());

      // 커스텀 로거 메서드 사용
      logger.dockerEvent(eventType, data.id, {
        action: data.Action, // Docker 이벤트의 Action 필드
        actorId: data.actor?.ID,
        actorAttributes: data.actor?.Attributes,
        // 필요한 다른 data 필드 추가 가능
      });

      // 이벤트 타입별 처리 로직
      if (eventType === 'start') {
        await handleContainerStart(data.id);
      } else if (eventType === 'stop' || eventType === 'die' || eventType === 'destroy') {
        await handleContainerStop(data.id, eventType); // eventType 전달하여 로그에 활용
      } else {
        await handleOtherEvents(data.id, eventType);
      }
    } catch (error: any) {
      logger.error(`이벤트 처리 중 오류 발생`, {
        operation: 'dockerEventHandler_data',
        eventType,
        containerId: data?.id, // 오류 발생 전 파싱된 ID가 있다면 포함
        rawChunk: chunk.toString(), // 원본 데이터 로깅
        error: error.message,
        stack: error.stack,
      });
    }
  });

  stream.on('error', (error) => {
    logger.error(`Docker 이벤트 스트림 오류`, {
      operation: 'dockerEventHandler_stream_error',
      eventType,
      error: error.message,
      stack: error.stack,
    });
    // 재연결 로직
    setTimeout(() => {
      logger.info(`Docker 이벤트 스트림 재연결 시도`, { operation: 'dockerEventHandler_reconnect', eventType });
      docker.getEvents({ filters: { event: [eventType] } }, dockerEventHandler(eventType));
    }, 5000);
  });
};

// 컨테이너 시작 이벤트 처리 함수
const handleContainerStart = async (containerId: string): Promise<void> => {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    const env = getContainerEnv(info?.Config.Env);
    const ip = info?.NetworkSettings.IPAddress;

    if (!env.host) {
      logger.debug(`컨테이너 ${containerId}에 host 환경변수가 없습니다. 무시합니다.`);
      return;
    }

    // 상세 네트워크 정보 수집
    const networkInfo = info?.NetworkSettings?.Networks || {};
    const networks = Object.keys(networkInfo).map((networkName) => ({
      name: networkName,
      ipAddress: networkInfo[networkName].IPAddress,
      gateway: networkInfo[networkName].Gateway,
      macAddress: networkInfo[networkName].MacAddress,
    }));

    logger.info(`컨테이너 ${containerId} 네트워크 정보:`, { networks });

    const locationList = env.location
      ?.split(',')
      .map((locInfo) => {
        const locData = locInfo.split(':');
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

    // 컨테이너 리소스 정보 수집
    try {
      const stats = await collectContainerStats(containerId);
      const cpuUsage = calculateCpuUsage(stats);
      const memoryUsage = calculateMemoryUsage(stats);

      logger.info(`컨테이너 ${containerId} 리소스 사용량:`, {
        cpuPercent: cpuUsage.toFixed(2) + '%',
        memoryPercent: memoryUsage.toFixed(2) + '%',
        memoryUsed: formatBytes(stats.memory_stats.usage),
        memoryLimit: formatBytes(stats.memory_stats.limit),
      });
    } catch (error) {
      logger.warn(`컨테이너 통계 수집 실패: ${error}`);
    }

    const serverName = `${env.host}${env.is_location?.toUpperCase() === 'Y' ? LOCATION_POSTFIX : ''}${
      env.group_host ? '_' + env.location_path : ''
    }`;

    serverListState.set({
      serverName,
      host: env.group_host || env.host,
      port: env.port || 80,
      network: [
        {
          dockerId: containerId,
          ip: `${ip}:${env.port}`,
        },
      ],
      isLocation: env.is_location?.toUpperCase(),
      location: locationList,
      sslCert:
        env.cert === 'pem'
          ? `/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`
          : `/etc/nginx/certs/${env.ssl || env.group_host || env.host}.crt`,
      sslKey:
        env.cert === 'pem'
          ? `/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`
          : `/etc/nginx/certs/${env.ssl || env.group_host || env.host}.key`,
      https:
        env.cert === 'pem'
          ? existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`) &&
            existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`)
          : existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}.crt`) &&
            existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}.key`),
      groupYn: env.group_host ? 'Y' : 'N',
      locationPath: env.location_path,
    });

    logger.info(`컨테이너 ${containerId} (${serverName}) 설정 완료`);

    // 설정 파일 생성
    await makeFiles();
  } catch (error) {
    logger.error(`컨테이너 시작 이벤트 처리 중 오류: ${error}`);
  }
};

// 컨테이너 중지 이벤트 처리 함수
const handleContainerStop = async (containerId: string, eventType: string): Promise<void> => {
  logger.info(`컨테이너 중지/소멸 처리 시작`, { operation: 'handleContainerStop', containerId, eventType });
  try {
    let containerName = 'unknown';
    let containerImage = 'unknown';
    let virtualHost = 'unknown';

    // 중지된 컨테이너 정보 조회 시도 (실패 가능성 있음)
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      const env = getContainerEnv(info?.Config.Env);
      containerName = info.Name;
      containerImage = info.Config.Image;
      virtualHost = env.host || '호스트 없음';
      logger.info(`중지된 컨테이너 정보 확인`, {
        operation: 'handleContainerStop_inspect',
        containerId,
        containerName,
        containerImage,
        virtualHost,
      });
    } catch (inspectError: any) {
      logger.warn(`중지된 컨테이너 정보 조회 실패`, {
        operation: 'handleContainerStop_inspect_fail',
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
    logger.info(`컨테이너 서버 목록에서 제거`, { operation: 'handleContainerStop', containerId });

    await makeFiles();
  } catch (error: any) {
    logger.error(`컨테이너 중지/소멸 처리 중 오류`, {
      operation: 'handleContainerStop',
      containerId,
      eventType,
      error: error.message,
      stack: error.stack,
    });
  }
};

// 기타 이벤트 처리 함수
const handleOtherEvents = async (containerId: string, eventType: string): Promise<void> => {
  logger.info(`기타 Docker 이벤트 처리 시작`, { operation: 'handleOtherEvents', containerId, eventType });
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    // 커스텀 로거 메서드 사용 또는 일반 info 사용
    logger.info(`컨테이너 이벤트 감지: ${eventType}`, {
      operation: 'handleOtherEvents',
      containerId,
      eventType,
      containerName: info.Name,
      containerImage: info.Config.Image,
      containerState: info.State.Status,
    });

    // 특정 이벤트 타입에 대한 추가 로깅
    if (eventType === 'pause') {
      logger.containerState(containerId, 'paused', { containerName: info.Name });
    } else if (eventType === 'unpause') {
      logger.containerState(containerId, 'resumed', { containerName: info.Name });
    } else if (eventType === 'restart') {
      logger.info(`컨테이너 재시작 감지, 시작 처리 호출`, { operation: 'handleOtherEvents', containerId });
      // 재시작은 내부적으로 stop -> start 흐름일 수 있으나, 명시적 restart 이벤트 처리
      await handleContainerStart(containerId); // 재시작 후 설정 적용
    }
    // 필요한 다른 이벤트 타입 처리 추가
  } catch (error: any) {
    // inspect 실패 등 오류 처리
    logger.warn(`${eventType} 이벤트 처리 중 오류 (정보 조회 등)`, {
      operation: 'handleOtherEvents',
      containerId,
      eventType,
      error: error.message,
      // stack: error.stack // warn 레벨에서는 스택 제외 고려
    });
  }
};

// CPU 사용량 계산 함수
const calculateCpuUsage = (stats: ContainerStats): number => {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  if (systemDelta > 0 && cpuDelta > 0) {
    const cpuCount =
      stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage ? stats.cpu_stats.cpu_usage.percpu_usage.length : 1);

    return (cpuDelta / systemDelta) * cpuCount * 100.0;
  }

  return 0;
};

// 메모리 사용량 계산 함수
const calculateMemoryUsage = (stats: ContainerStats): number => {
  const memoryUsage = stats.memory_stats.usage;
  const memoryLimit = stats.memory_stats.limit;

  if (memoryUsage && memoryLimit) {
    return (memoryUsage / memoryLimit) * 100.0;
  }

  return 0;
};

// 바이트 포맷팅 함수
const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Nginx 재시작 함수 개선
const nginxReload = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    // 커스텀 로거 메서드 사용
    logger.nginxConfig('재로드 시도', 'N/A', { operation: 'nginxReload' });
    exec('nginx -s reload', (error, stdout, stderr) => {
      // stdout/stderr는 debug 레벨로 로깅하는 것이 일반적
      if (stdout) logger.debug(`Nginx 재로드 stdout`, { operation: 'nginxReload', output: stdout });
      if (stderr) logger.debug(`Nginx 재로드 stderr`, { operation: 'nginxReload', output: stderr }); // 오류성 stderr도 있을 수 있음

      if (error) {
        // 커스텀 로거 메서드 사용 및 에러 정보 포함
        logger.error(`Nginx 재로드 실패`, {
          operation: 'nginxReload',
          action: '재로드 실패',
          error: error.message,
          stack: error.stack,
          stderr, // stderr는 실패 시 중요한 정보일 수 있음
        });
        reject(error);
      } else {
        // 커스텀 로거 메서드 사용
        logger.nginxConfig('재로드 성공', 'N/A', { operation: 'nginxReload' });
        resolve();
      }
    });
  });
};

// Upstream 설정 파일 생성 함수 개선
const makeUpstream = async (conItem: IContainerStatusItem): Promise<void> => {
  if (!conItem.serverName) {
    logger.warn('serverName 없는 컨테이너 항목, Upstream 생성 건너뜀', {
      operation: 'makeUpstream',
      containerData: conItem, // 문제 분석을 위해 전체 데이터 로깅 고려
    });
    return;
  }

  const configPath = `${templates.upstream.TARGET_PATH}/${templates.upstream.PREFIX}${conItem.serverName}.conf`;
  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`; // 로그 경로도 메타데이터에 포함하면 좋음

  try {
    if (conItem.network.length > 0) {
      logger.debug(`Upstream 설정 생성 시작`, { operation: 'makeUpstream', serverName: conItem.serverName, configPath });

      // EJS 렌더링
      const rendered = await new Promise<string>((resolve, reject) => {
        ejs.renderFile(templates.upstream.PATH, conItem, {}, (err, str) => {
          if (err) reject(err);
          else resolve(str);
        });
      });

      // 파일 쓰기
      writeFileSync(configPath, rendered);
      // 커스텀 로거 메서드 사용
      logger.nginxConfig('생성', configPath, { serverName: conItem.serverName, type: 'upstream' });
    } else {
      // 설정 파일 제거 로직
      if (existsSync(configPath)) {
        logger.info(`네트워크 정보 없음, Upstream 설정 파일 제거 시도`, {
          operation: 'makeUpstream',
          serverName: conItem.serverName,
          configPath,
        });
        unlink(configPath, (err) => {
          if (err) {
            logger.error(`Upstream 설정 파일 삭제 실패`, {
              operation: 'makeUpstream_delete',
              serverName: conItem.serverName,
              configPath,
              error: err.message,
              stack: err.stack,
            });
          } else {
            // 커스텀 로거 메서드 사용
            logger.nginxConfig('삭제', configPath, { serverName: conItem.serverName, type: 'upstream', reason: 'No network' });
          }
        });
      } else {
        logger.debug(`Upstream 설정 파일 없음, 삭제 건너뜀`, { operation: 'makeUpstream', serverName: conItem.serverName, configPath });
      }
    }

    // Nginx 로그 디렉토리 생성 (디버그 레벨 유지 또는 info로 변경 고려)
    if (!existsSync(nginxLogPath)) {
      mkdirSync(nginxLogPath, { recursive: true });
      logger.debug(`Nginx 로그 디렉토리 생성`, { operation: 'makeUpstream_logdir', path: nginxLogPath });
    }
  } catch (error: any) {
    logger.error(`Upstream 설정 처리 중 오류`, {
      operation: 'makeUpstream',
      serverName: conItem.serverName,
      configPath, // 오류 발생 시점의 configPath
      error: error.message,
      stack: error.stack,
    });
  }
};

// Vhost 설정 파일 생성 함수 개선
const makeVhost = async (conItem: IContainerStatusItem): Promise<void> => {
  if (!conItem.serverName) {
    logger.warn('serverName이 없는 컨테이너 항목을 무시합니다.');
    return;
  }

  const configFileName = conItem.groupYn === 'Y' ? conItem.host : conItem.serverName;
  const configPath = `${templates.vhost.TARGET_PATH}/${templates.vhost.PREFIX}${configFileName}.conf`;
  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  try {
    if (conItem.network.length > 0) {
      logger.debug(`${configFileName}에 대한 Vhost 설정 생성 시작`);

      // EJS 템플릿 렌더링을 Promise로 변환
      const rendered = await new Promise<string>((resolve, reject) => {
        ejs.renderFile(templates.vhost.PATH, conItem, {}, (err, str) => {
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
    logger.error(`Vhost 설정 파일 생성 중 오류: ${error}`);
  }
};

// Location 설정 파일 생성 함수 개선
const makeLocation = async (conItem: IContainerStatusItem): Promise<void> => {
  if (!conItem.serverName) {
    logger.warn('serverName이 없는 컨테이너 항목을 무시합니다.');
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

// 모든 설정 파일 생성 함수 개선
const makeFiles = async (): Promise<void> => {
  logger.info('Nginx 설정 파일 생성/갱신 시작', { operation: 'makeFiles' });
  try {
    const serverList = serverListState.get();
    const promises = [];
    const serverNames = Object.keys(serverList);

    logger.info(`처리 대상 서버 ${serverNames.length}개`, { operation: 'makeFiles', servers: serverNames });

    for (const key in serverList) {
      const val = serverList[key];
      // 각 make 함수 호출 시 로깅은 해당 함수 내부에서 처리
      promises.push(makeUpstream(val));

      if (val.locationPath) {
        promises.push(makeLocation(val));
      }

      // isLocation이 'Y'가 아닌 경우 (즉, 메인 vhost 또는 group vhost)
      if (val.isLocation !== 'Y') {
        // group host인 경우, 동일 host에 대해 vhost 생성이 중복될 수 있음.
        // makeVhost 내부에서 파일 존재 여부 등으로 처리하거나, 여기서 중복 호출 방지 로직 추가 필요
        // 예시: group host 별로 한 번만 vhost 생성하도록 관리
        // (간단하게는 val.groupYn === 'Y' && val.host === key 또는 특정 플래그로 관리)
        // 여기서는 일단 모든 non-location에 대해 호출한다고 가정
        promises.push(makeVhost(val));
      }
    }

    await Promise.all(promises);
    logger.info('모든 설정 파일 생성/갱신 완료', { operation: 'makeFiles', count: serverNames.length });

    // Nginx 재시작 (내부에서 로깅 처리)
    await nginxReload();
  } catch (error: any) {
    logger.error(`설정 파일 생성/갱신 중 오류`, {
      operation: 'makeFiles',
      error: error.message,
      stack: error.stack,
    });
    // 오류 발생 시 Nginx 리로드를 건너뛸지 여부 결정 필요
  }
};

// 초기 컨테이너 감시 설정 함수
const initWatch = async (containers?: ContainerInfo[]): Promise<void> => {
  if (!containers || containers.length === 0) {
    logger.info('실행 중인 컨테이너가 없습니다.');
    return;
  }

  logger.info(`${containers.length}개의 실행 중인 컨테이너 발견, 설정 초기화 중...`);

  try {
    await Promise.all(
      containers.map(async (container) => {
        try {
          const containerObj = docker.getContainer(container.Id);
          const info = await containerObj.inspect();

          const env = getContainerEnv(info?.Config.Env);
          const ip = info?.NetworkSettings.IPAddress;

          if (!env.host) {
            logger.debug(`컨테이너 ${container.Id}의 VIRTUAL_HOST 환경변수가 없습니다.`);
            return;
          }

          const locationList = env.location
            ?.split(',')
            .map((locInfo) => {
              const locData = locInfo.split(':');
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

          const serverName = `${env.host}${env.is_location?.toUpperCase() === 'Y' ? LOCATION_POSTFIX : ''}${
            env.group_host ? '_' + env.location_path : ''
          }`;

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
              env.cert === 'pem'
                ? `/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`
                : `/etc/nginx/certs/${env.ssl || env.group_host || env.host}.crt`,
            sslKey:
              env.cert === 'pem'
                ? `/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`
                : `/etc/nginx/certs/${env.ssl || env.group_host || env.host}.key`,
            https:
              env.cert === 'pem'
                ? existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`) &&
                  existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`)
                : existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}.crt`) &&
                  existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}.key`),
            groupYn: env.group_host ? 'Y' : 'N',
            locationPath: env.location_path,
          });

          logger.info(`컨테이너 ${container.Id} (${serverName}) 초기화 완료`);
        } catch (error) {
          logger.error(`컨테이너 ${container.Id} 초기화 중 오류: ${error}`);
        }
      })
    );

    logger.info('모든 컨테이너 초기화 완료, 설정 파일 생성 중...');
    await makeFiles();
  } catch (error) {
    logger.error(`초기화 중 오류 발생: ${error}`);
  }
};

// 컨테이너 헬스체크 함수 추가
const containerHealthCheck = async (): Promise<void> => {
  try {
    const containers = await docker.listContainers({ all: true });
    logger.info(`헬스체크: ${containers.length}개 컨테이너 발견`);

    const runningContainers = containers.filter((c) => c.State === 'running');
    const stoppedContainers = containers.filter((c) => c.State !== 'running');

    logger.info(`헬스체크 결과: ${runningContainers.length}개 실행 중, ${stoppedContainers.length}개 중지됨`);

    // 각 컨테이너의 기본 상태 정보 로깅
    for (const container of runningContainers) {
      try {
        const stats = await collectContainerStats(container.Id);
        const cpuUsage = calculateCpuUsage(stats);
        const memoryUsage = calculateMemoryUsage(stats);

        logger.debug(`컨테이너 ${container.Id} 상태:`, {
          name: container.Names[0],
          image: container.Image,
          cpuPercent: cpuUsage.toFixed(2) + '%',
          memoryPercent: memoryUsage.toFixed(2) + '%',
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
const scheduleHealthCheck = (intervalMinutes: number): NodeJS.Timeout => {
  logger.info(`${intervalMinutes}분 간격으로 컨테이너 헬스체크 스케줄링`);
  return setInterval(containerHealthCheck, intervalMinutes * 60 * 1000);
};

// 메인 실행 부분
async function main() {
  try {
    logger.info('Docker 모니터링 서비스 시작');

    // 현재 실행 중인 컨테이너 목록 가져오기
    const containers = await new Promise<ContainerInfo[]>((resolve, reject) => {
      docker.listContainers({ all: true, filters: { status: ['running'] } }, (err, containers) => {
        if (err) {
          reject(err);
        } else {
          resolve(containers || []);
        }
      });
    });

    // 초기화
    await initWatch(containers);

    // 다양한 Docker 이벤트 감시 설정
    MONITORED_EVENTS.forEach((eventType) => {
      docker.getEvents({ filters: { event: [eventType] } }, dockerEventHandler(eventType));
      logger.info(`Docker ${eventType} 이벤트 모니터링 시작`);
    });

    // 헬스체크 스케줄링 (5분 간격)
    scheduleHealthCheck(5);

    logger.info('모든 초기화 완료, Docker 이벤트 모니터링 중...');
  } catch (error) {
    logger.error(`서비스 시작 중 오류 발생: ${error}`);
    process.exit(1);
  }
}

// 애플리케이션 시작
main().catch((error) => {
  logger.error(`예상치 못한 오류 발생: ${error}`);
  process.exit(1);
});
