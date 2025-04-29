import { ITemplates } from "@interfaces/watcher";
import Dockerode from "dockerode";

export const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });
export const NGINX_CONF_DIR = "/app/conf.d";
export const templates: ITemplates = {
  upstream: {
    PATH: "/app/templates/upstream-template.ejs",
    TARGET_PATH: `${NGINX_CONF_DIR}/upstream.conf/`,
    PREFIX: "upstream-",
  },
  vhost: {
    PATH: "/app/templates/vhost-template.ejs",
    TARGET_PATH: `${NGINX_CONF_DIR}/vhost.conf/`,
    PREFIX: "vhost-",
  },
  vhostCookie: {
    PATH: "/app/templates/vhost-cookie-routing-template.ejs",
    TARGET_PATH: `${NGINX_CONF_DIR}/vhost.conf/`,
    PREFIX: "vhost-",
  },
  location: {
    PATH: "/app/templates/location-template.ejs",
    TARGET_PATH: `${NGINX_CONF_DIR}/location.conf/`,
    PREFIX: "location-",
  },
};
export const LOCATION_POSTFIX = "_location";

// 모니터링할 Docker 이벤트 유형을 확장
export const MONITORED_EVENTS = [
  "start",
  "stop",
  "die",
  "destroy",
  "create",
  "pause",
  "unpause",
  "kill",
  "restart",
];
