FROM node:23.11.0-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-balance/server.js ./server.js
# 포트 환경변수 및 노출 추가
ENV PORT=8088
EXPOSE 8088


CMD [ "node", "server.js" ]