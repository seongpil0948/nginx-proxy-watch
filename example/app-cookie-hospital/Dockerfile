FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-cookie-hospital/server.js ./server.js
ENV PORT=8085
EXPOSE 8085
CMD [ "node", "server.js" ]