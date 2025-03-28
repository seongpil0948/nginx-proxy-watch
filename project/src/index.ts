import _ from 'lodash';
import Dockerode, { ContainerInfo, ContainerInspectInfo } from 'dockerode';
import * as ejs from 'ejs';
import { ContainerEnv, IContainersStatus, IContainerStatusItem, IServerList, IServerListInstance, ITemplates } from '@interfaces/watcher';
import { exec } from 'child_process';
import ReadableStream = NodeJS.ReadableStream;
import { access, constants, existsSync, mkdirSync, unlink, writeFileSync } from 'fs';
import { logger } from './logging';

// const logger = console;
// const __dirname = path.resolve();

// @ts-ignore
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
const NGINX_CONF_DIR = '/app/conf.d';
const ENV_PREFIX = 'VIRTUAL_';
const templates: ITemplates = {
  upstream: {
    // PATH: path.resolve(__dirname, '../templates/upstream-template.ejs'),
    PATH: '/app/templates/upstream-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/upstream.conf/`,
    PREFIX: 'upstream-',
  },
  vhost: {
    // PATH: path.resolve(__dirname, '../templates/vhost-template.ejs'),
    PATH: '/app/templates/vhost-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/vhost.conf/`,
    PREFIX: 'vhost-',
  },
  location: {
    // PATH: path.resolve(__dirname, '../templates/vhost-template.ejs'),
    PATH: '/app/templates/location-template.ejs',
    TARGET_PATH: `${NGINX_CONF_DIR}/location.conf/`,
    PREFIX: 'location-',
  },
};
const LOCATION_POSTFIX = '_location';

const ServerListInstance = (): IServerListInstance => {
  let instance: IServerList;

  const ServerList = (): IServerList => {
    let sList = {} as IContainersStatus;

    return {
      set: (containerItem: IContainerStatusItem) => {
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

const getContainerEnv = (envs?: string[]): ContainerEnv => {
  if (!envs) {
    return { host: '', port: 80 } as ContainerEnv;
  }
  return _.reduce<string, ContainerEnv>(
    envs,
    (prev, next) => {
      const pos = next.indexOf('=');
      const key = next.substring(0, pos);
      const value = next.substring(pos + 1);

      if (key.startsWith(ENV_PREFIX)) {
        return {
          ...prev,
          [key.substring(ENV_PREFIX.length).toLowerCase()]: value,
        };
      }

      return prev;
    },
    { host: '', port: 80 } as ContainerEnv
  );
};

const dockerStartEv = (err: any, stream?: ReadableStream) => {
  logger.info('### Docker Start Event ###');
  if (err || !stream) {
    logger.error('### Docker Start Event Error ###', err.message);
    return;
  }

  stream.on('data', (chunk) => {
    const data = JSON.parse(chunk.toString());
    docker.getContainer(data.id).inspect({}, (err: any, info?: ContainerInspectInfo) => {
      const env = getContainerEnv(info?.Config.Env);
      const ip = info?.NetworkSettings.IPAddress;

      if (!env.host) {
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

      serverListState.set({
        serverName: `${env.host}${env.is_location?.toUpperCase() === 'Y' ? LOCATION_POSTFIX : ''}${
          env.group_host ? '_' + env.location_path : ''
        }`,
        host: env.group_host || env.host,
        port: env.port || 80,
        network: [
          {
            dockerId: data.id,
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
      logger.info('certs_crt:::', existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`));
      logger.info('certs_key:::', existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`));
      logger.info('###start###', data.id);
      logger.info('###start###', ip);
      logger.info(env);

      makeFiles();
    });
  });
};

const dockerStopEv = (err: any, stream?: ReadableStream) => {
  logger.info('### Docker Stop Event ###');
  if (err || !stream) {
    logger.error('### Docker Stop Event Error ###', err.message);
    return;
  }

  stream.on('data', (chunk) => {
    const data = JSON.parse(chunk.toString());
    docker.getContainer(data.id).inspect({}, (err: any, info?: ContainerInspectInfo) => {
      const env = getContainerEnv(info?.Config.Env);

      serverListState.del(data.id);
      logger.info('###stop###', data.id);
      logger.info(env);

      makeFiles();
    });
  });
};

const nginxReload = (): void => {
  exec('nginx -s reload', (error, stdout, stderr) => {
    logger.log(stdout);
    logger.log(stderr);
    if (error) {
      logger.error(error.message);
    }
  });
};

const makeUpstream = (conItem: IContainerStatusItem): void => {
  if (conItem.serverName) {
    if (conItem.network.length > 0) {
      ejs.renderFile(templates.upstream.PATH, conItem, {}, (err: Error | null, str: string) => {
        if (err) {
          logger.error('### Upstream 파일생성 실패 ###', err);
          return;
        }

        // writeFileSync(path.resolve(__dirname, `./${templates.upstream.PREFIX}${conItem.serverName}.conf`), str);
        writeFileSync(`${templates.upstream.TARGET_PATH}/${templates.upstream.PREFIX}${conItem.serverName}.conf`, str);
      });
    } else {
      // const fPath = path.resolve(__dirname, `./${templates.upstream.PREFIX}${conItem.serverName}.conf`);
      const fPath = `${templates.upstream.TARGET_PATH}/${templates.upstream.PREFIX}${conItem.serverName}.conf`;

      access(fPath, constants.F_OK, (err) => {
        if (err) return logger.error('삭제할 수 없는 파일입니다.');
        unlink(fPath, (err) => (err ? logger.error(err) : logger.info('삭제 완료')));
      });
    }
  }

  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  if (!existsSync(nginxLogPath)) {
    mkdirSync(nginxLogPath);
  }

  nginxReload();
};

const makeVhost = (conItem: IContainerStatusItem): void => {
  if (conItem.serverName) {
    if (conItem.network.length > 0) {
      ejs.renderFile(templates.vhost.PATH, conItem, {}, (err: Error | null, str: string) => {
        if (err) {
          logger.error('### Vhost 파일생성 실패 ###', err);
          return;
        }

        // writeFileSync(path.resolve(__dirname, `./${templates.vhost.PREFIX}${conItem.serverName}.conf`), str);
        writeFileSync(
          `${templates.vhost.TARGET_PATH}/${templates.vhost.PREFIX}${conItem.groupYn === 'Y' ? conItem.host : conItem.serverName}.conf`,
          str
        );
      });
    } else {
      // const fPath = path.resolve(__dirname, `./${templates.vhost.PREFIX}${conItem.serverName}.conf`);
      const fPath = `${templates.vhost.TARGET_PATH}/${templates.vhost.PREFIX}${
        conItem.groupYn === 'Y' ? conItem.host : conItem.serverName
      }.conf`;

      access(fPath, constants.F_OK, (err) => {
        if (err) return logger.error('삭제할 수 없는 파일입니다.');
        unlink(fPath, (err) => (err ? logger.error(err) : logger.info('삭제 완료')));
      });
    }
  }

  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  if (!existsSync(nginxLogPath)) {
    mkdirSync(nginxLogPath);
  }

  nginxReload();
};

const makeLocation = (conItem: IContainerStatusItem): void => {
  if (conItem.serverName) {
    if (conItem.network.length > 0) {
      ejs.renderFile(templates.location.PATH, conItem, {}, (err: Error | null, str: string) => {
        if (err) {
          logger.error('### Location 파일생성 실패 ###', err);
          return;
        }

        if (!existsSync(`${templates.location.TARGET_PATH}${conItem.host}`)) {
          mkdirSync(`${templates.location.TARGET_PATH}${conItem.host}`);
        }
        writeFileSync(`${templates.location.TARGET_PATH}${conItem.host}/${templates.location.PREFIX}${conItem.serverName}.conf`, str);
      });
    } else {
      const fPath = `${templates.location.TARGET_PATH}${conItem.host}/${templates.location.PREFIX}${conItem.serverName}.conf`;

      access(fPath, constants.F_OK, (err) => {
        if (err) return logger.error('삭제할 수 없는 파일입니다.');
        unlink(fPath, (err) => (err ? logger.error(err) : logger.info('삭제 완료')));
      });
    }
  }

  const nginxLogPath = `/var/log/nginx/${conItem.serverName}`;

  if (!existsSync(nginxLogPath)) {
    mkdirSync(nginxLogPath);
  }

  nginxReload();
};

const makeFiles = (): void => {
  _.forEach<IContainersStatus>(serverListState.get(), (val, key) => {
    makeUpstream(val);
    if (val.locationPath) {
      makeLocation(val);
    }
    if (val.isLocation !== 'Y') {
      makeVhost(val);
    }
  });
};

const initWatch = async (containers?: ContainerInfo[]): Promise<void> => {
  if (containers && containers?.length > 0) {
    await Promise.all(
      containers?.map((container) => {
        return new Promise<string>((resolve, reject) => {
          docker.getContainer(container.Id).inspect({}, (err: any, info?: ContainerInspectInfo) => {
            const env = getContainerEnv(info?.Config.Env);
            const ip = info?.NetworkSettings.IPAddress;

            if (!env.host) {
              resolve(container.Id);
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

            serverListState.set({
              serverName: `${env.host}${env.is_location?.toUpperCase() === 'Y' ? LOCATION_POSTFIX : ''}${
                env.group_host ? '_' + env.location_path : ''
              }`,
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
            logger.info('certs_crt:::', existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_crt.pem`));
            logger.info('certs_key:::', existsSync(`/etc/nginx/certs/${env.ssl || env.group_host || env.host}_key.pem`));
            logger.info('###start###', container.Id);
            logger.info('###start###', ip);
            logger.info(env);

            resolve(container.Id);
          });
        });
      })
    );
    makeFiles();
  }
};

try {
  docker.listContainers({ all: true, filters: { status: ['running'] } }, (err, containers) => {
    initWatch(containers);
  });

  docker.getEvents({ filters: { event: ['start'] } }, dockerStartEv);
  docker.getEvents({ filters: { event: ['stop'] } }, dockerStopEv);
} catch (e: any) {
  logger.error(e);
}
