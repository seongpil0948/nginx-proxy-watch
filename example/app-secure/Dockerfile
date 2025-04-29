FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-secure/server.js ./server.js
ENV PORT=8087
EXPOSE 8087
CMD [ "node", "server.js" ]