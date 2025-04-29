FROM node:23.11.0-slim
WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-cookie-pharmacy/server.js ./server.js
ENV PORT=8086
EXPOSE 8086
CMD [ "node", "server.js" ]