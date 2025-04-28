# example/app-cookie-hospital/Dockerfile
FROM node:16-alpine
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-cookie-hospital/server.js ./server.js
ENV PORT=8083
EXPOSE 8083
CMD [ "node", "server.js" ]
