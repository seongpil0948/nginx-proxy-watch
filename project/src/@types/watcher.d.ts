import { ContainerInfo } from "dockerode";

export interface ContainerEnv {
  host: string;
  port: number;
  https?: string;
  ssl?: string;
  conf?: string;
  location?: string;
  is_location?: string;
  cert?: "pem" | "crt";
  group_host?: string;
  location_path?: string;

  cookie_name?: string;
  routing_map?: { [key: string]: string };
  default_upstream?: string;
}

export interface Template {
  PATH: string;
  TARGET_PATH: string;
  PREFIX: string;
}

export interface IContainerStatusItem {
  serverName: string;
  host: string;
  port: number;
  network: {
    dockerId: string;
    ip?: string;
  }[];
  https: boolean;
  sslCert: string;
  sslKey: string;
  ssl?: string;
  isLocation?: string;
  location?: {
    host: string;
    path: string;
  }[];
  cert?: "pem" | "crt";
  groupYn?: string;
  locationPath?: string;

  routingCookieName?: string;
  routingMap?: { [key: string]: string };
  defaultUpstream?: string;
  hostHeaderMap?: { [key: string]: string };
}

export interface IContainersStatus {
  [key: string]: IContainerStatusItem;
}

export interface IServerListStats {
  totalServers: number;
  totalNetworkEntries: number;
  validNetworkEntries: number;
  invalidNetworkEntries: number;
}

export interface IServerList {
  set: (containerItem: IContainerStatusItem) => void;
  get: () => IContainersStatus;
  del: (dockerId: string) => void;
  cleanup: () => void; // New method for cleaning up empty servers
  getStats: () => IServerListStats; // New method for getting statistics
}

export interface IServerListInstance {
  getInstance: () => IServerList;
}

export interface ITemplates {
  [key: string]: Template;
}
