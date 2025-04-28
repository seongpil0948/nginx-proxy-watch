# example/app-group-service-a/Dockerfile
FROM node:16-alpine
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-group-service-a/server.js ./server.js
ENV PORT=8082
EXPOSE 8082
CMD [ "node", "server.js" ]
