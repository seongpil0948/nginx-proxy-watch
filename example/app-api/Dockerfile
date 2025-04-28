# example/app-api/Dockerfile
FROM node:16-alpine
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-api/server.js ./server.js
ENV PORT=8081
EXPOSE 8081
CMD [ "node", "server.js" ]
