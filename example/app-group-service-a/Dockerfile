FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-group-service-a/server.js ./server.js
ENV PORT=8083
EXPOSE 8083
CMD [ "node", "server.js" ]