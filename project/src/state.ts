import {
  IServerListInstance,
  IServerList,
  IContainersStatus,
  IContainerStatusItem,
} from "@interfaces/watcher";
import { logger } from "./util";
import _ from "lodash";

// 컨테이너 상태를 저장하는 싱글톤 인스턴스
const ServerListInstance = (): IServerListInstance => {
  let instance: IServerList;

  const ServerList = (): IServerList => {
    let sList = {} as IContainersStatus;

    return {
      set: (containerItem: IContainerStatusItem) => {
        logger.debug(
          `컨테이너 정보 추가/업데이트: ${containerItem.serverName}`
        );
        sList = {
          ...sList,
          [containerItem.serverName]: {
            ...sList[containerItem.serverName],
            ...containerItem,
            network: [
              ...(sList[containerItem.serverName]
                ? sList[containerItem.serverName].network
                : []),
              ...containerItem.network,
            ],
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
            network: (sList[key] ? sList[key].network : []).filter(
              (item) => item.dockerId !== dockerId
            ),
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

export const serverListState = ServerListInstance().getInstance();
