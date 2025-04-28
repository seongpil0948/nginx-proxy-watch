# example/app-cookie-pharmacy/Dockerfile
FROM node:16-alpine
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-cookie-pharmacy/server.js ./server.js
ENV PORT=8084
EXPOSE 8084
CMD [ "node", "server.js" ]
