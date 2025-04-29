FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-admin/server.js ./server.js
ENV PORT=8082
EXPOSE 8082
CMD [ "node", "server.js" ]