import { ContainerInfo } from 'dockerode';

export interface ContainerEnv {
  host: string;
  port: number;
  https?: string;
  ssl?: string;
  conf?: string;
  location?: string;
  is_location?: string;
  cert?: 'pem' | 'crt';
  group_yn?: string;
  location_path?: string;
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
  cert?: 'pem' | 'crt';
  groupYn?: string;
  locationPath?: string;
}

export interface IContainersStatus {
  [key: string]: IContainerStatusItem;
}

export interface IServerList {
  set: (containerItem: IContainerStatusItem) => void;
  get: () => IContainersStatus;
  del: (dockerId: string) => void;
}

export interface IServerListInstance {
  getInstance: () => IServerList;
}

export interface ITemplates {
  [key: string]: Template;
}
