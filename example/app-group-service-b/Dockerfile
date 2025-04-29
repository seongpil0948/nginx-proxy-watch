FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-group-service-b/server.js ./server.js
ENV PORT=8084
EXPOSE 8084
CMD [ "node", "server.js" ]