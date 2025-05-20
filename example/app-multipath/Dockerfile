FROM node:23.11.0-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-multipath/server.js ./server.js
ENV PORT=8090
EXPOSE 8090


CMD [ "node", "server.js" ]