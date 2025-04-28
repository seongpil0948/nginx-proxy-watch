# example/app-main/Dockerfile
FROM node:16-alpine
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-main/server.js ./server.js
ENV PORT=8080
EXPOSE 8080
CMD [ "node", "server.js" ]
