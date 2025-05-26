import {
  IServerListInstance,
  IServerList,
  IContainersStatus,
  IContainerStatusItem,
} from "@interfaces/watcher";
import { logger } from "./util";
import _ from "lodash";

// Container state management singleton instance
const ServerListInstance = (): IServerListInstance => {
  let instance: IServerList;

  const ServerList = (): IServerList => {
    let sList = {} as IContainersStatus;

    return {
      set: (containerItem: IContainerStatusItem) => {
        logger.debug(
          `Adding/updating container info: ${containerItem.serverName}`,
          {
            operation: "serverList_set",
            serverName: containerItem.serverName,
            networkCount: containerItem.network?.length || 0,
          }
        );

        // Filter out invalid network entries before storing
        const validNetwork =
          containerItem.network?.filter((nw) => {
            if (!nw.ip) return false;
            const parts = nw.ip.split(":");
            if (parts.length !== 2) return false;
            const [ip, port] = parts;
            return ip && ip.trim() !== "" && port && port.trim() !== "";
          }) || [];

        sList = {
          ...sList,
          [containerItem.serverName]: {
            ...sList[containerItem.serverName],
            ...containerItem,
            network: [
              ...(sList[containerItem.serverName]
                ? sList[containerItem.serverName].network.filter(
                    (existing) =>
                      // Keep existing valid entries that are not being replaced
                      !validNetwork.some(
                        (newEntry) => newEntry.dockerId === existing.dockerId
                      )
                  )
                : []),
              ...validNetwork,
            ],
          },
        };

        // Log the update
        logger.debug(`Container state updated`, {
          operation: "serverList_set",
          serverName: containerItem.serverName,
          totalNetworkEntries: sList[containerItem.serverName].network.length,
          validNetworkEntries: validNetwork.length,
        });
      },

      get: () => {
        return sList;
      },

      del: (dockerId: string) => {
        logger.debug(
          `Removing container network info by Docker ID: ${dockerId}`,
          {
            operation: "serverList_del",
            dockerId,
          }
        );

        let removedFromServers: string[] = [];
        let emptyServers: string[] = [];

        sList = _.mapValues(sList, (item, key) => {
          const originalNetworkCount = (sList[key]?.network || []).length;
          const filteredNetwork = (sList[key]?.network || []).filter(
            (item) => item.dockerId !== dockerId
          );

          if (originalNetworkCount !== filteredNetwork.length) {
            removedFromServers.push(key);
          }

          // Mark servers with no valid network entries for cleanup
          if (filteredNetwork.length === 0) {
            emptyServers.push(key);
          }

          return {
            ...sList[key],
            network: filteredNetwork,
          };
        });

        // Clean up empty servers
        emptyServers.forEach((serverName) => {
          logger.debug(`Removing empty server from state: ${serverName}`, {
            operation: "serverList_cleanup",
            serverName,
            dockerId,
          });
          delete sList[serverName];
        });

        logger.debug(`Container cleanup completed`, {
          operation: "serverList_del",
          dockerId,
          removedFromServers,
          emptyServersRemoved: emptyServers,
          remainingServers: Object.keys(sList).length,
        });
      },

      // New method to clean up servers with no valid network entries
      cleanup: () => {
        const beforeCount = Object.keys(sList).length;
        const emptyServers: string[] = [];

        Object.keys(sList).forEach((serverName) => {
          const server = sList[serverName];
          const validNetwork =
            server.network?.filter((nw) => {
              if (!nw.ip) return false;
              const parts = nw.ip.split(":");
              if (parts.length !== 2) return false;
              const [ip, port] = parts;
              return ip && ip.trim() !== "" && port && port.trim() !== "";
            }) || [];

          if (validNetwork.length === 0) {
            emptyServers.push(serverName);
            delete sList[serverName];
          } else if (validNetwork.length !== server.network.length) {
            // Update server with only valid network entries
            sList[serverName] = {
              ...server,
              network: validNetwork,
            };
          }
        });

        const afterCount = Object.keys(sList).length;

        if (emptyServers.length > 0 || beforeCount !== afterCount) {
          logger.info(`Server list cleanup completed`, {
            operation: "serverList_cleanup",
            beforeCount,
            afterCount,
            emptyServersRemoved: emptyServers,
          });
        }
      },

      // New method to get statistics
      getStats: () => {
        const servers = Object.keys(sList);
        const totalNetworkEntries = servers.reduce((acc, serverName) => {
          return acc + (sList[serverName].network?.length || 0);
        }, 0);

        const validNetworkEntries = servers.reduce((acc, serverName) => {
          const validCount =
            sList[serverName].network?.filter((nw) => {
              if (!nw.ip) return false;
              const parts = nw.ip.split(":");
              if (parts.length !== 2) return false;
              const [ip, port] = parts;
              return ip && ip.trim() !== "" && port && port.trim() !== "";
            }).length || 0;
          return acc + validCount;
        }, 0);

        return {
          totalServers: servers.length,
          totalNetworkEntries,
          validNetworkEntries,
          invalidNetworkEntries: totalNetworkEntries - validNetworkEntries,
        };
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
