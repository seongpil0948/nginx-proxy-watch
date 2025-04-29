FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-balance/server.js ./server.js


CMD [ "node", "server.js" ]